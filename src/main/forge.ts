import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, exists } from './fsutil'
import { downloadFile, fetchJson } from './http'
import { selectJava } from './java'
import { getVersionJson } from './mojang'
import { p } from './paths'
import type { Progress } from './progress'

const PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const MAVEN_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge'

export interface ForgeLoader {
  version: string
  stable: boolean
  channel: 'recommended' | 'latest'
}

let promosCache: { at: number; promos: Record<string, string> } | null = null

async function promotions(): Promise<Record<string, string>> {
  if (promosCache && Date.now() - promosCache.at < 6 * 60 * 60 * 1000) return promosCache.promos
  const data = await fetchJson<{ promos?: Record<string, string> }>(PROMOTIONS_URL, { retries: 3 })
  const promos = data.promos ?? {}
  promosCache = { at: Date.now(), promos }
  return promos
}

/** Рекомендованная и последняя сборки Forge для указанной версии Minecraft. */
export async function forgeLoaders(mcVersion: string): Promise<ForgeLoader[]> {
  const promos = await promotions()
  const recommended = promos[`${mcVersion}-recommended`]
  const latest = promos[`${mcVersion}-latest`]
  const list: ForgeLoader[] = []
  if (recommended) list.push({ version: recommended, stable: true, channel: 'recommended' })
  if (latest && latest !== recommended) list.push({ version: latest, stable: false, channel: 'latest' })
  return list
}

export async function latestForgeLoader(mcVersion: string): Promise<string> {
  const list = await forgeLoaders(mcVersion)
  if (list.length === 0) throw new Error(`Forge пока не поддерживает Minecraft ${mcVersion}`)
  return list[0].version
}

function runInstaller(javaPath: string, installer: string, target: string, progress: Progress): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ['-jar', installer, '--installClient', target], {
      cwd: target,
      windowsHide: true,
      env: { ...process.env, JAVA_HOME: path.dirname(path.dirname(javaPath)) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tail: string[] = []
    let buffer = ''
    let lines = 0

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const parts = buffer.split(/\r\n|\n|\r/)
      buffer = parts.pop() ?? ''
      for (const raw of parts) {
        const line = raw.trim()
        if (!line) continue
        lines++
        tail.push(line)
        if (tail.length > 14) tail.shift()
        if (/(Downloading|Installing|Extracting|Patching|Built|Processing)/i.test(line) && lines % 12 === 0) {
          progress.note(line.length > 150 ? `${line.slice(0, 147)}…` : line)
        }
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (error) => {
      reject(new Error(`Не удалось запустить установщик Forge: ${error.message}`))
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const detail = tail.slice(-8).join('\n')
      reject(new Error(`Установщик Forge завершился с кодом ${code ?? '—'}${detail ? `\n${detail}` : ''}`))
    })
  })
}

/**
 * Устанавливает Forge официальным installer'ом в общую папку данных.
 * Installer сам скачивает библиотеки и создаёт version JSON, который затем
 * используется обычным механизмом запуска (inheritsFrom + BootstrapLauncher).
 */
export async function ensureForgeVersion(
  mcVersion: string,
  forgeVersion: string | undefined,
  progress: Progress,
  javaPathOverride?: string | null,
): Promise<{ id: string; loader: string }> {
  const loader = forgeVersion || (await latestForgeLoader(mcVersion))
  const id = `${mcVersion}-forge-${loader}`
  const jsonPath = path.join(p.version(id), `${id}.json`)
  if (await exists(jsonPath)) return { id, loader }

  await ensureDir(path.dirname(jsonPath))
  const cacheDir = path.join(p.cache(), 'forge', `${mcVersion}-${loader}`)
  await ensureDir(cacheDir)
  const installer = path.join(cacheDir, `forge-${mcVersion}-${loader}-installer.jar`)
  if (!(await exists(installer))) {
    progress.phase('forge', 1)
    progress.note(`Скачивание установщика Forge ${loader}`)
    await downloadFile(`${MAVEN_URL}/${mcVersion}-${loader}/forge-${mcVersion}-${loader}-installer.jar`, installer)
  }

  // Официальный installer отказывается работать без профиля лаунчера.
  const profiles = path.join(p.root(), 'launcher_profiles.json')
  if (!(await exists(profiles))) {
    await fs.promises.writeFile(
      profiles,
      JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2),
      'utf8',
    )
  }

  const vanilla = await getVersionJson(mcVersion)
  const required = vanilla.javaVersion?.majorVersion ?? 8
  const component = vanilla.javaVersion?.component ?? 'jre-legacy'
  const java = await selectJava(component, required, javaPathOverride, progress)

  progress.phase('forge', 1)
  progress.note(`Forge ${loader}: установка (Java ${java.java.major})`)
  await runInstaller(java.java.path, installer, p.root(), progress)

  if (!(await exists(jsonPath))) {
    throw new Error(`Forge ${loader} установился, но файл версии не найден: ${jsonPath}`)
  }
  try {
    const parsed = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8')) as { id?: string; mainClass?: string }
    if (!parsed.id || !parsed.mainClass) throw new Error('нет id или mainClass')
  } catch (e) {
    throw new Error(`Forge ${loader}: повреждён файл версии — ${(e as Error).message}`)
  }

  return { id, loader }
}

export function forgeVersionId(mcVersion: string, loader: string): string {
  return `${mcVersion}-forge-${loader}`
}
