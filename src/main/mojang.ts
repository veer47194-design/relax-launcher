import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ArgEntry,
  AssetIndexRef,
  DownloadInfo,
  Library,
  ManifestVersion,
  ResolvedVersion,
  Rule,
  VersionJson,
  VersionManifest,
} from '../shared/types'
import type { DownloadController } from './downloads'
import { ensureDir, exists, fileSize, humanBytes } from './fsutil'
import { downloadFile, fetchJson, mapLimit } from './http'
import { p } from './paths'
import { Progress } from './progress'
import { extractZip } from './zip'
import { config } from './config'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const RESOURCES_URL = 'https://resources.download.minecraft.net'
const DEFAULT_LIBRARY_URL = 'https://libraries.minecraft.net/'

let manifestCache: { at: number; data: VersionManifest } | null = null
const versionCache = new Map<string, VersionJson>()

export function osName(): 'windows' | 'osx' | 'linux' {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

export function osArch(): string {
  if (process.arch === 'x64') return 'x86_64'
  if (process.arch === 'ia32') return 'x86'
  return process.arch
}

export function defaultFeatures(resolution?: { width: number; height: number } | null): Record<string, boolean> {
  return {
    is_demo_user: false,
    has_custom_resolution: !!resolution,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  }
}

export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean>): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    let matches = true
    if (rule.os) {
      if (rule.os.name && rule.os.name !== osName()) matches = false
      if (rule.os.arch && rule.os.arch !== osArch()) matches = false
      if (rule.os.version) {
        try {
          if (!new RegExp(rule.os.version).test(os.release())) matches = false
        } catch {
          matches = false
        }
      }
    }
    if (rule.features) {
      for (const [key, value] of Object.entries(rule.features)) {
        if (!!features[key] !== value) matches = false
      }
    }
    if (matches) allowed = rule.action === 'allow'
  }
  return allowed
}

export async function getManifest(force = false, controller?: DownloadController): Promise<VersionManifest> {
  if (!force && manifestCache && Date.now() - manifestCache.at < 5 * 60 * 1000) return manifestCache.data
  const cacheFile = path.join(p.cache(), 'version_manifest_v2.json')
  try {
    await controller?.gate()
    const data = await fetchJson<VersionManifest>(MANIFEST_URL, { retries: 3, signal: controller?.signal })
    manifestCache = { at: Date.now(), data }
    await ensureDir(p.cache())
    await fs.promises.writeFile(cacheFile, JSON.stringify(data), 'utf8').catch(() => {})
    return data
  } catch (e) {
    if (manifestCache) return manifestCache.data
    try {
      const data = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8')) as VersionManifest
      manifestCache = { at: Date.now(), data }
      return data
    } catch {
      throw e
    }
  }
}

export async function findManifestVersion(id: string, controller?: DownloadController): Promise<ManifestVersion> {
  const manifest = await getManifest(false, controller)
  const found = manifest.versions.find((v) => v.id === id)
  if (!found) throw new Error(`Версия ${id} не найдена в манифесте Mojang`)
  return found
}

export async function getVersionJson(
  id: string,
  force = false,
  controller?: DownloadController,
): Promise<VersionJson> {
  if (!force) {
    const cached = versionCache.get(id)
    if (cached) return cached
  }
  await controller?.gate()
  const file = path.join(p.version(id), `${id}.json`)
  if (!force && (await exists(file))) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8')) as VersionJson
      if (parsed && parsed.id && parsed.mainClass) {
        versionCache.set(id, parsed)
        return parsed
      }
    } catch {
      /* перекачаем */
    }
  }
  const meta = await findManifestVersion(id, controller)
  const json = await fetchJson<VersionJson>(meta.url, { retries: 3, signal: controller?.signal })
  await ensureDir(p.version(id))
  await fs.promises.writeFile(file, JSON.stringify(json, null, 2), 'utf8')
  versionCache.set(id, json)
  return json
}

export async function saveVersionJson(json: VersionJson): Promise<void> {
  await ensureDir(p.version(json.id))
  await fs.promises.writeFile(path.join(p.version(json.id), `${json.id}.json`), JSON.stringify(json, null, 2), 'utf8')
  versionCache.set(json.id, json)
}

export interface MavenCoord {
  group: string
  artifact: string
  version: string
  classifier?: string
  ext: string
  path: string
}

export function parseMaven(name: string): MavenCoord {
  let ext = 'jar'
  let base = name
  const at = name.indexOf('@')
  if (at >= 0) {
    ext = name.slice(at + 1)
    base = name.slice(0, at)
  }
  const parts = base.split(':')
  if (parts.length < 3) throw new Error(`Некорректная Maven-координата: ${name}`)
  const [group, artifact, version, classifier] = parts
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`
  const coordPath = `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
  return { group, artifact, version, classifier, ext, path: coordPath }
}

function libraryKey(lib: Library): string {
  try {
    const c = parseMaven(lib.name)
    return `${c.group}:${c.artifact}:${c.classifier ?? ''}`
  } catch {
    return lib.name
  }
}

export function libraryArtifact(lib: Library): { path: string; url: string; sha1?: string; size?: number } | null {
  if (lib.downloads?.artifact) {
    const a = lib.downloads.artifact
    return { path: a.path ?? parseMaven(lib.name).path, url: a.url, sha1: a.sha1, size: a.size }
  }
  // У библиотеки есть downloads, но только classifiers (например, старые lwjgl-platform):
  // основного артефакта нет, скачивать по Maven-координате нельзя.
  if (lib.downloads) return null
  try {
    const coord = parseMaven(lib.name)
    const base = lib.url ?? DEFAULT_LIBRARY_URL
    return { path: coord.path, url: base.endsWith('/') ? base + coord.path : `${base}/${coord.path}`, sha1: lib.sha1, size: lib.size }
  } catch {
    return null
  }
}

export function nativeArtifact(lib: Library): { path: string; url: string; sha1?: string; size?: number; classifier: string } | null {
  const nativesKey = lib.natives?.[osName()]
  if (!nativesKey) return null
  const arch = process.arch === 'ia32' ? '32' : '64'
  const classifier = nativesKey.replace('${arch}', arch)
  const info = lib.downloads?.classifiers?.[classifier]
  if (info) return { path: info.path ?? '', url: info.url, sha1: info.sha1, size: info.size, classifier }
  try {
    const coord = parseMaven(lib.name)
    const file = `${coord.artifact}-${coord.version}-${classifier}.jar`
    const rel = `${coord.group.replace(/\./g, '/')}/${coord.artifact}/${coord.version}/${file}`
    const base = lib.url ?? DEFAULT_LIBRARY_URL
    return { path: rel, url: base.endsWith('/') ? base + rel : `${base}/${rel}`, classifier }
  } catch {
    return null
  }
}

export async function resolveVersion(id: string, controller?: DownloadController): Promise<ResolvedVersion> {
  const chain: VersionJson[] = []
  let current: string | undefined = id
  const guard = new Set<string>()
  while (current) {
    if (guard.has(current)) throw new Error(`Циклическое наследование версий: ${current}`)
    guard.add(current)
    const json = await getVersionJson(current, false, controller)
    chain.unshift(json)
    current = json.inheritsFrom
    if (chain.length > 12) throw new Error('Слишком глубокая цепочка наследования версий')
  }

  const last = chain[chain.length - 1]
  const libs = new Map<string, Library>()
  for (const json of chain) {
    for (const lib of json.libraries ?? []) {
      libs.set(libraryKey(lib), lib)
    }
  }

  const gameArgs: ArgEntry[] = []
  const jvmArgs: ArgEntry[] = []
  let minecraftArguments: string | undefined
  let assetIndex: AssetIndexRef | undefined
  let client: DownloadInfo | null = null
  let clientVersionId = id
  let logging: ResolvedVersion['logging']
  let javaVersion: { component: string; majorVersion: number } | undefined

  for (const json of chain) {
    if (json.arguments?.game) gameArgs.push(...json.arguments.game)
    if (json.arguments?.jvm) jvmArgs.push(...json.arguments.jvm)
    if (json.minecraftArguments) minecraftArguments = json.minecraftArguments
    if (json.assetIndex) assetIndex = json.assetIndex
    if (json.downloads?.client) {
      client = json.downloads.client
      clientVersionId = json.id
    }
    if (json.logging?.client) logging = { argument: json.logging.client.argument, file: json.logging.client.file }
    if (json.javaVersion) javaVersion = json.javaVersion
  }

  if (!assetIndex) throw new Error(`В версии ${id} отсутствует индекс ресурсов`)
  if (!client) throw new Error(`В версии ${id} отсутствует клиент игры`)

  return {
    id,
    type: last.type ?? 'release',
    mainClass: last.mainClass,
    libraries: [...libs.values()],
    gameArgs,
    jvmArgs,
    minecraftArguments,
    assetIndexId: assetIndex.id,
    assetIndex,
    client,
    clientVersionId,
    javaComponent: javaVersion?.component ?? 'jre-legacy',
    javaMajor: javaVersion?.majorVersion ?? 8,
    logging,
    inheritedFrom: chain.length > 1 ? chain[0].id : undefined,
  }
}

export interface InstalledVersion {
  version: ResolvedVersion
  clientJar: string
  libraryPaths: string[]
  nativesDir: string
  assetsDir: string
  gameAssetsDir: string | null
  mapToResources: boolean
}

interface AssetObject {
  hash: string
  size: number
}

interface AssetIndexJson {
  objects: Record<string, AssetObject>
  virtual?: boolean
  map_to_resources?: boolean
}

const assetIndexCache = new Map<string, AssetIndexJson>()

async function getAssetIndex(ref: AssetIndexRef, controller?: DownloadController): Promise<AssetIndexJson> {
  const cached = assetIndexCache.get(ref.id)
  if (cached) return cached
  await controller?.gate()
  const file = path.join(p.indexes(), `${ref.id}.json`)
  if (await exists(file)) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8')) as AssetIndexJson
      assetIndexCache.set(ref.id, parsed)
      return parsed
    } catch {
      /* перекачаем */
    }
  }
  await downloadFile(ref.url, file, { sha1: ref.sha1, size: ref.size, controller })
  const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8')) as AssetIndexJson
  assetIndexCache.set(ref.id, parsed)
  return parsed
}

export async function installVersion(
  id: string,
  progress: Progress,
  controller?: DownloadController,
): Promise<InstalledVersion> {
  progress.phase('prepare')
  progress.note('Чтение манифеста версий')
  const version = await resolveVersion(id, controller)
  const concurrency = config().get().settings.downloadConcurrency

  const clientJar = path.join(p.version(version.clientVersionId), `${version.clientVersionId}.jar`)
  const nativesDir = path.join(p.version(id), 'natives')
  const assetsDir = p.assets()

  const index = await getAssetIndex(version.assetIndex, controller)
  const assetEntries = Object.entries(index.objects)
  const allowedLibs = version.libraries.filter((lib) => rulesAllow(lib.rules, defaultFeatures()))
  const nativeLibs = allowedLibs.filter((lib) => !!nativeArtifact(lib))
  const loggingFile = version.logging?.file

  const totalUnits = 1 + allowedLibs.length + assetEntries.length + (loggingFile ? 1 : 0) + 1
  let done = 0
  progress.set(done, totalUnits, 'Клиент игры')

  // 1. Клиент игры
  await downloadFile(version.client!.url, clientJar, {
    sha1: version.client!.sha1,
    size: version.client!.size,
    controller,
    onBytes: (received, total) => {
      const frac = total > 0 ? Math.min(1, received / total) : 0
      progress.set(done + frac, totalUnits, `Клиент игры · ${humanBytes(received)} из ${humanBytes(total)}`)
    },
  })
  done++
  progress.set(done, totalUnits, 'Клиент игры готов')

  // 2. Библиотеки
  progress.phase('libraries', totalUnits)
  progress.set(done, totalUnits, `Библиотеки 0 / ${allowedLibs.length}`)
  const nativeJobs: { lib: Library; path: string }[] = []

  const libResults = await mapLimit(
    allowedLibs,
    concurrency,
    async (lib) => {
      let artifactPath: string | null = null
      const artifact = libraryArtifact(lib)
      if (artifact) {
        const dest = path.join(p.libraries(), artifact.path)
        await downloadFile(artifact.url, dest, { sha1: artifact.sha1, size: artifact.size, controller })
        artifactPath = dest
      }
      const native = nativeArtifact(lib)
      if (native) {
        const dest = path.join(p.libraries(), native.path)
        await downloadFile(native.url, dest, { sha1: native.sha1, size: native.size, controller })
        nativeJobs.push({ lib, path: dest })
      }
      return artifactPath
    },
    (n, totalLibs) => {
      progress.set(done + n, totalUnits, `Библиотеки ${n} / ${totalLibs}`)
    },
  )
  const libraryPaths = libResults.filter((x): x is string => !!x)
  done += allowedLibs.length
  await controller?.gate()
  progress.set(done, totalUnits, 'Библиотеки готовы')

  // 3. Нативные библиотеки
  if (nativeJobs.length > 0) {
    progress.phase('natives', totalUnits)
    await fs.promises.rm(nativesDir, { recursive: true, force: true })
    await ensureDir(nativesDir)
    for (const job of nativeJobs) {
      const exclude = ['META-INF/', ...(job.lib.extract?.exclude ?? [])]
      await extractZip(job.path, nativesDir, { exclude })
    }
    progress.set(done, totalUnits, 'Нативные библиотеки распакованы')
  }
  done++

  // 4. Ресурсы
  progress.phase('assets', totalUnits)
  progress.set(done, totalUnits, `Ресурсы 0 / ${assetEntries.length}`)
  await ensureDir(p.objects())
  let assetsDone = 0
  await mapLimit(
    assetEntries,
    Math.max(8, concurrency),
    async ([, obj]) => {
      const prefix = obj.hash.slice(0, 2)
      const dest = path.join(p.objects(), prefix, obj.hash)
      if (await exists(dest)) {
        const size = await fileSize(dest)
        if (size === obj.size) {
          assetsDone++
          return
        }
      }
      await downloadFile(`${RESOURCES_URL}/${prefix}/${obj.hash}`, dest, {
        sha1: obj.hash,
        size: obj.size,
        controller,
      })
      assetsDone++
    },
    (n, totalAssets) => {
      progress.set(done + n, totalUnits, `Ресурсы ${n} / ${totalAssets}`)
    },
  )
  done += assetEntries.length

  // Виртуальные ресурсы для старых версий
  let gameAssetsDir: string | null = null
  if (index.virtual) {
    const virtualDir = p.virtualAssets(version.assetIndexId)
    await ensureDir(virtualDir)
    await mapLimit(Object.entries(index.objects), concurrency, async ([name, obj]) => {
      const target = path.join(virtualDir, ...name.split('/'))
      await ensureDir(path.dirname(target))
      if (!(await exists(target))) {
        const src = path.join(p.objects(), obj.hash.slice(0, 2), obj.hash)
        try {
          await fs.promises.link(src, target)
        } catch {
          await fs.promises.copyFile(src, target)
        }
      }
    })
    gameAssetsDir = virtualDir
  }

  // 5. Конфиг логирования
  if (loggingFile) {
    progress.phase('logging', totalUnits)
    const dest = path.join(assetsDir, 'log_configs', loggingFile.id)
    await downloadFile(loggingFile.url, dest, {
      sha1: loggingFile.sha1,
      size: loggingFile.size,
      controller,
    })
    done++
  }

  progress.set(totalUnits, totalUnits, 'Готово')
  return {
    version,
    clientJar,
    libraryPaths,
    nativesDir,
    assetsDir,
    gameAssetsDir,
    mapToResources: !!index.map_to_resources,
  }
}

/** Старые версии (альфа/бета) читают ресурсы из папки resources внутри gameDir. */
export async function materializeLegacyResources(ref: AssetIndexRef, targetDir: string): Promise<void> {
  const index = await getAssetIndex(ref)
  await ensureDir(targetDir)
  await mapLimit(Object.entries(index.objects), 16, async ([name, obj]) => {
    const target = path.join(targetDir, ...name.split('/'))
    await ensureDir(path.dirname(target))
    if (await exists(target)) return
    const src = path.join(p.objects(), obj.hash.slice(0, 2), obj.hash)
    try {
      await fs.promises.link(src, target)
    } catch {
      await fs.promises.copyFile(src, target)
    }
  })
}

export async function installedVersions(): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(p.versions(), { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

export async function removeVersion(id: string): Promise<void> {
  versionCache.delete(id)
  await fs.promises.rm(p.version(id), { recursive: true, force: true })
}

export function clearVersionCache() {
  versionCache.clear()
}

export { assetIndexCache }
