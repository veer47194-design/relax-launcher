import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { DownloadInfo, JavaInfo } from '../shared/types'
import { config } from './config'
import { ensureDir, exists } from './fsutil'
import { downloadFile, fetchJson, mapLimit } from './http'
import { p } from './paths'
import { Progress } from './progress'

const execFileAsync = promisify(execFile)

const RUNTIME_MANIFEST_URL =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

interface RuntimeManifest {
  [platform: string]: {
    [component: string]: { manifest: DownloadInfo; version: { name: string; released?: string } }[]
  }
}

interface RuntimeFilesJson {
  files: Record<
    string,
    {
      type: 'file' | 'directory' | 'link'
      downloads?: { raw?: DownloadInfo; lzma?: DownloadInfo }
      executable?: boolean
      target?: string
    }
  >
}

let runtimeManifestCache: { at: number; data: RuntimeManifest } | null = null
const javaInfoCache = new Map<string, JavaInfo>()

export function runtimePlatform(): string {
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') return 'windows-arm64'
    return process.arch === 'ia32' ? 'windows-x86' : 'windows-x64'
  }
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return process.arch === 'ia32' ? 'linux-i386' : 'linux'
}

export function javaExecutableName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

export async function getRuntimeManifest(force = false): Promise<RuntimeManifest> {
  if (!force && runtimeManifestCache && Date.now() - runtimeManifestCache.at < 12 * 60 * 60 * 1000) {
    return runtimeManifestCache.data
  }
  const cacheFile = p.runtimeManifest()
  try {
    const data = await fetchJson<RuntimeManifest>(RUNTIME_MANIFEST_URL, { retries: 3 })
    runtimeManifestCache = { at: Date.now(), data }
    await ensureDir(path.dirname(cacheFile))
    await fs.promises.writeFile(cacheFile, JSON.stringify({ at: Date.now(), data }), 'utf8').catch(() => {})
    return data
  } catch (e) {
    try {
      const raw = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8')) as { at: number; data: RuntimeManifest }
      runtimeManifestCache = raw
      return raw.data
    } catch {
      throw e
    }
  }
}

export function runtimeDir(component: string): string {
  return path.join(p.runtime(), component, runtimePlatform())
}

export function runtimeJavaPath(component: string): string {
  return path.join(runtimeDir(component), 'bin', javaExecutableName())
}

async function parseJava(pathToJava: string, source: JavaInfo['source']): Promise<JavaInfo | null> {
  const cached = javaInfoCache.get(pathToJava)
  if (cached) return cached
  if (!(await exists(pathToJava))) return null
  try {
    const { stdout, stderr } = await execFileAsync(pathToJava, ['-XshowSettings:properties', '-version'], {
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    const output = `${stdout}\n${stderr}`
    const version = /java\.version\s*=\s*(.+)/.exec(output)?.[1]?.trim() ?? ''
    const vendor = /java\.vendor\s*=\s*(.+)/.exec(output)?.[1]?.trim() ?? ''
    const arch = /os\.arch\s*=\s*(.+)/.exec(output)?.[1]?.trim() ?? ''
    if (!version) return null
    const major = version.startsWith('1.') ? Number(version.split('.')[1]) : Number(version.split(/[.\-+]/)[0])
    if (!Number.isFinite(major) || major < 8) return null
    const info: JavaInfo = { path: pathToJava, version, major, vendor, arch, source }
    javaInfoCache.set(pathToJava, info)
    return info
  } catch {
    return null
  }
}

function candidateJavaPaths(): string[] {
  const exe = javaExecutableName()
  const candidates = new Set<string>()

  if (process.env.JAVA_HOME) candidates.add(path.join(process.env.JAVA_HOME, 'bin', exe))

  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir.replace(/^"|"$/g, ''), exe)
    if (fs.existsSync(candidate)) candidates.add(candidate)
  }

  const roots: string[] = []
  if (process.platform === 'win32') {
    const programFiles = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
    for (const pf of programFiles) {
      roots.push(
        path.join(pf, 'Java'),
        path.join(pf, 'Eclipse Adoptium'),
        path.join(pf, 'Microsoft'),
        path.join(pf, 'Zulu'),
        path.join(pf, 'BellSoft'),
        path.join(pf, 'Amazon Corretto'),
        path.join(pf, 'Semeru'),
        path.join(pf, 'Temurin'),
      )
    }
    if (process.env.LOCALAPPDATA) {
      roots.push(
        path.join(process.env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'),
        path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft'),
      )
    }
    if (process.env.USERPROFILE) roots.push(path.join(process.env.USERPROFILE, '.jdks'))
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines', '/opt/homebrew/opt', '/usr/local/opt')
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/opt/java')
  }

  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root)) {
        candidates.add(path.join(root, entry, 'bin', exe))
        candidates.add(path.join(root, entry, 'Contents', 'Home', 'bin', exe))
      }
    } catch {
      /* нет папки */
    }
  }

  return [...candidates].filter((c) => fs.existsSync(c))
}

export async function detectSystemJava(): Promise<JavaInfo[]> {
  const paths = candidateJavaPaths()
  const settingsPath = config().get().settings.javaPath
  if (settingsPath) paths.unshift(settingsPath)
  const infos = await Promise.all(paths.map((c) => parseJava(c, 'system')))
  const unique = new Map<string, JavaInfo>()
  for (const info of infos) {
    if (!info) continue
    const key = info.path.toLowerCase()
    if (!unique.has(key)) unique.set(key, info)
  }
  return [...unique.values()].sort((a, b) => b.major - a.major)
}

export async function ensureMojangRuntime(component: string, progress: Progress): Promise<string | null> {
  const exe = runtimeJavaPath(component)
  if (await exists(exe)) {
    const info = await parseJava(exe, 'mojang')
    if (info) return exe
  }

  let manifest: RuntimeManifest
  try {
    manifest = await getRuntimeManifest()
  } catch {
    return null
  }
  const entries = manifest[runtimePlatform()]?.[component]
  if (!entries || entries.length === 0) return null
  const entry = entries[0]
  const dir = runtimeDir(component)
  await ensureDir(dir)

  progress.phase('java', 1)
  progress.note(`Загрузка Java ${entry.version.name}`)
  const manifestFile = path.join(dir, 'manifest.json')
  await downloadFile(entry.manifest.url, manifestFile, { sha1: entry.manifest.sha1, size: entry.manifest.size })

  const filesJson = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')) as RuntimeFilesJson
  const files = Object.entries(filesJson.files).filter(
    (entry): entry is [string, { type: 'file'; downloads: { raw: DownloadInfo } }] =>
      entry[1].type === 'file' && !!entry[1].downloads?.raw,
  )

  progress.phase('java', files.length)
  let done = 0
  await mapLimit(
    files,
    12,
    async ([relative, meta]) => {
      const target = path.join(dir, ...relative.split('/'))
      await downloadFile(meta.downloads.raw.url, target, {
        sha1: meta.downloads.raw.sha1,
        size: meta.downloads.raw.size,
      })
      done++
    },
    (n, total) => progress.set(n, total, `Java ${entry.version.name} · файлы ${n} / ${total}`),
  )

  javaInfoCache.delete(exe)
  const info = await parseJava(exe, 'mojang')
  if (!info) throw new Error('Java скачана, но не запускается')
  return exe
}

export interface JavaSelection {
  java: JavaInfo
  note?: string
}

export async function selectJava(
  component: string,
  requiredMajor: number,
  overridePath: string | null | undefined,
  progress: Progress,
): Promise<JavaSelection> {
  const settings = config().get().settings
  const explicit = overridePath || settings.javaPath

  if (explicit) {
    const info = await parseJava(explicit, overridePath ? 'custom' : 'system')
    if (!info) throw new Error(`Java не найдена по пути: ${explicit}`)
    if (info.major < requiredMajor) {
      throw new Error(
        `Для этой версии нужна Java ${requiredMajor}+, а выбрана Java ${info.major}. Измените путь в настройках.`,
      )
    }
    return { java: info }
  }

  if (settings.autoJava) {
    try {
      const pathToJava = await ensureMojangRuntime(component, progress)
      if (pathToJava) {
        const info = await parseJava(pathToJava, 'mojang')
        if (info && info.major >= requiredMajor) {
          return { java: info, note: `Java ${info.major} (Mojang, ${component})` }
        }
      }
    } catch (e) {
      console.warn('[java] не удалось установить рантайм Mojang:', (e as Error).message)
    }
  }

  const system = await detectSystemJava()
  const suitable = system
    .filter((j) => j.major >= requiredMajor)
    .sort((a, b) => a.major - b.major)[0]
  if (suitable) return { java: suitable, note: `Системная Java ${suitable.major}` }

  throw new Error(
    `Не найдена подходящая Java ${requiredMajor}+. Установите её или включите автоматическую загрузку Java в настройках.`,
  )
}

export async function listRuntimes(): Promise<{ component: string; path: string }[]> {
  const result: { component: string; path: string }[] = []
  try {
    for (const component of await fs.promises.readdir(p.runtime())) {
      const exe = runtimeJavaPath(component)
      if (await exists(exe)) result.push({ component, path: exe })
    }
  } catch {
    /* пусто */
  }
  return result
}

export function javaHomeFromPath(pathToJava: string): string {
  return path.dirname(path.dirname(pathToJava))
}

export function systemInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
  }
}
