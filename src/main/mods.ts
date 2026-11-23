import fs from 'node:fs'
import path from 'node:path'
import type { ContentKind, Instance, ModInfo, OptimizeMod } from '../shared/types'
import { config, ensureInstanceDirs } from './config'
import { ensureDir, exists, safeJoin } from './fsutil'
import { downloadFile, mapLimit } from './http'
import { getProject, getVersions, pickFile } from './modrinth'
import { p } from './paths'
import { Progress } from './progress'
import { readZipFile } from './zip'

interface FabricModJson {
  id?: string
  name?: string
  version?: string
  description?: string
  icon?: string | Record<string, string>
  logoFile?: string
}

function readFabricMeta(jar: string): FabricModJson | null {
  try {
    const raw = readZipFile(jar, 'fabric.mod.json')
    if (!raw) return null
    return JSON.parse(raw.toString('utf8')) as FabricModJson
  } catch {
    return null
  }
}

function readForgeMeta(jar: string): FabricModJson | null {
  try {
    const toml = readZipFile(jar, 'META-INF/mods.toml')
    if (toml) {
      const text = toml.toString('utf8')
      const pick = (key: string) =>
        new RegExp(`^\\s*${key}\\s*=\\s*['"]([^'"]*)['"]`, 'm').exec(text)?.[1]
      const name = pick('displayName')
      const version = pick('version')
      const description = pick('description')
      const logoFile = pick('logoFile')
      if (name || version) return { name, version, description, logoFile }
    }
    const legacy = readZipFile(jar, 'mcmod.info')
    if (legacy) {
      const parsed = JSON.parse(legacy.toString('utf8')) as
        | { modid?: string; name?: string; version?: string; description?: string; logoFile?: string }[]
        | { modList?: { modid?: string; name?: string; version?: string; description?: string; logoFile?: string }[] }
      const first = Array.isArray(parsed) ? parsed[0] : parsed.modList?.[0]
      if (first) {
        return {
          name: first.name,
          version: first.version,
          description: first.description,
          logoFile: first.logoFile,
        }
      }
    }
    return null
  } catch {
    return null
  }
}

function readModMeta(jar: string): FabricModJson | null {
  return readFabricMeta(jar) ?? readForgeMeta(jar)
}

const IMAGE_ENTRY_RE = /\.(png|jpe?g|webp|gif)$/i

function normalizeIconPath(raw: string): string | null {
  const clean = raw.replace(/\\/g, '/').replace(/^\.?\//, '').trim()
  if (!clean || !IMAGE_ENTRY_RE.test(clean)) return null
  if (clean.split('/').some((part) => part === '..' || part === '')) return null
  return clean
}

function iconCandidates(meta: FabricModJson | null): string[] {
  const out: string[] = []
  const icon = meta?.icon
  if (typeof icon === 'string') {
    out.push(icon)
  } else if (icon && typeof icon === 'object') {
    const keys = Object.keys(icon).sort((a, b) => Number(b) - Number(a))
    for (const key of keys) {
      if (typeof icon[key] === 'string') out.push(icon[key])
    }
  }
  if (meta?.logoFile) out.push(meta.logoFile)
  out.push('pack.png', 'icon.png', 'logo.png')

  const unique: string[] = []
  for (const raw of out) {
    const clean = normalizeIconPath(raw)
    if (clean && !unique.includes(clean)) unique.push(clean)
  }
  return unique
}

/** Ищет иконку мода внутри JAR: fabric.mod.json → icon, mods.toml → logoFile, иначе pack.png. */
export function modIconEntry(jar: string, meta?: FabricModJson | null): string | null {
  const info = meta ?? readModMeta(jar)
  for (const candidate of iconCandidates(info)) {
    try {
      if (readZipFile(jar, candidate)) return candidate
    } catch {
      /* битый JAR — просто попробуем следующий вариант */
    }
  }
  return null
}

const CONTENT_FOLDERS: Record<ContentKind, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
}

function contentDir(instanceId: string, kind: ContentKind = 'mod'): string {
  return path.join(p.instance(instanceId), CONTENT_FOLDERS[kind])
}

export async function listMods(instanceId: string, kind: ContentKind = 'mod'): Promise<ModInfo[]> {
  const dir = contentDir(instanceId, kind)
  await ensureDir(dir)
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const mods: ModInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.(jar|zip)(\.disabled)?$/i.test(entry.name)) continue
    const full = path.join(dir, entry.name)
    const stat = await fs.promises.stat(full)
    const meta = readModMeta(full)
    const iconEntry = modIconEntry(full, meta)
    const enabled = !entry.name.endsWith('.disabled')
    mods.push({
      file: entry.name,
      name: meta?.name || entry.name.replace(/\.(jar|zip)(\.disabled)?$/i, ''),
      version: typeof meta?.version === 'string' ? meta.version : '',
      description: typeof meta?.description === 'string' ? meta.description : '',
      enabled,
      size: stat.size,
      iconUrl: iconEntry
        ? `relax-mod-icon://local/${encodeURIComponent(instanceId)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(iconEntry)}`
        : null,
    })
  }
  return mods.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export async function toggleMod(
  instanceId: string,
  file: string,
  enabled: boolean,
  kind: ContentKind = 'mod',
): Promise<void> {
  const dir = contentDir(instanceId, kind)
  const current = safeJoin(dir, file)
  if (!(await exists(current))) throw new Error('Файл мода не найден')
  let target: string
  if (enabled) {
    if (!file.endsWith('.disabled')) return
    target = current.slice(0, -'.disabled'.length)
  } else {
    if (file.endsWith('.disabled')) return
    target = `${current}.disabled`
  }
  await fs.promises.rename(current, target)
}

export async function removeMod(
  instanceId: string,
  file: string,
  kind: ContentKind = 'mod',
): Promise<void> {
  const target = safeJoin(contentDir(instanceId, kind), file)
  await fs.promises.rm(target, { force: true })
}

async function installModFile(
  instance: Instance,
  projectId: string,
  progress: Progress | null,
  visited: Set<string>,
  installed: string[],
  skipped: string[],
  kind: ContentKind = 'mod',
): Promise<void> {
  if (visited.has(projectId)) return
  visited.add(projectId)

  const project = await getProject(projectId)
  if (kind === 'mod' && instance.loader === 'vanilla') {
    throw new Error('Моды можно устанавливать только в сборки Fabric или Forge')
  }

  const versions = await getVersions(
    project.id,
    instance.mcVersion,
    kind === 'mod' ? instance.loader : undefined,
  )
  if (versions.length === 0) {
    const suffix = kind === 'mod' ? ` (${instance.loader === 'forge' ? 'Forge' : 'Fabric'})` : ''
    skipped.push(`${project.title} — нет версии для ${instance.mcVersion}${suffix}`)
    return
  }
  const version = versions[0]
  const file = pickFile(version)
  if (!file) {
    skipped.push(`${project.title} — нет файла для скачивания`)
    return
  }

  const filename = path.basename(file.filename)
  const dest = safeJoin(contentDir(instance.id, kind), filename)
  await ensureDir(path.dirname(dest))
  if (await exists(dest)) {
    installed.push(`${project.title} (уже установлен)`)
  } else {
    progress?.note(`Скачивание ${project.title}`)
    await downloadFile(file.url, dest, { sha1: file.hashes.sha1, size: file.size })
    installed.push(project.title)
  }

  // Зависимости имеют смысл только у модов; у паков и шейдеров их нет.
  if (kind !== 'mod') return
  for (const dep of version.dependencies ?? []) {
    if (dep.dependency_type !== 'required') continue
    if (!dep.project_id) continue
    try {
      await installModFile(instance, dep.project_id, progress, visited, installed, skipped, kind)
    } catch (e) {
      skipped.push(`${project.title}: зависимость — ${(e as Error).message}`)
    }
  }
}

export async function installMod(
  instanceId: string,
  projectId: string,
  kind: ContentKind = 'mod',
): Promise<ModInfo[]> {
  const cfg = config()
  const instance = cfg.getInstance(instanceId)
  await ensureInstanceDirs(instanceId)
  const progress = new Progress(`mod:${instanceId}:${projectId}`, `Установка: ${kind === 'mod' ? 'мод' : kind === 'shader' ? 'шейдер' : 'ресурс-пак'}`)
  try {
    const installed: string[] = []
    const skipped: string[] = []
    await installModFile(instance, projectId, progress, new Set(), installed, skipped, kind)
    progress.done(installed.join(', ') || skipped.join('; '))
    return listMods(instanceId, kind)
  } catch (e) {
    progress.fail((e as Error).message)
    throw e
  }
}

/* ---------------- Оптимизация ---------------- */

interface OptimizeEntry extends OptimizeMod {
  maxVersion?: string
}

const OPTIMIZE_MODS: OptimizeEntry[] = [
  { slug: 'sodium', title: 'Sodium', description: 'Современный рендер: значительно больше FPS и меньше фризов' },
  { slug: 'lithium', title: 'Lithium', description: 'Оптимизация игровой логики и тиков без изменения геймплея' },
  { slug: 'ferrite-core', title: 'FerriteCore', description: 'Снижает потребление памяти моделями и блоками' },
  { slug: 'krypton', title: 'Krypton', description: 'Оптимизация сетевого стека — меньше лагов на серверах' },
  { slug: 'entityculling', title: 'Entity Culling', description: 'Не рендерит сущности, которые не видно' },
  { slug: 'immediatelyfast', title: 'ImmediatelyFast', description: 'Ускоряет немедленный режим отрисовки интерфейса и текста' },
  { slug: 'clumps', title: 'Clumps', description: 'Объединяет опыт в один шар — меньше просадок FPS' },
  { slug: 'badoptimizations', title: 'BadOptimizations', description: 'Набор небольших оптимизаций клиента' },
  { slug: 'dynamic-fps', title: 'Dynamic FPS', description: 'Снижает FPS, когда окно неактивно — меньше нагрузка' },
  { slug: 'modernfix', title: 'ModernFix', description: 'Ускоряет загрузку и уменьшает потребление памяти' },
  { slug: 'moreculling', title: 'More Culling', description: 'Дополнительный отсев невидимых граней блоков' },
  { slug: 'indium', title: 'Indium', description: 'Совместимость Sodium с модами на Fabric Rendering API', maxVersion: '1.21.1', optional: true },
  { slug: 'sodium-extra', title: 'Sodium Extra', description: 'Дополнительные настройки графики Sodium', optional: true },
]

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split(/[.\-+]/)
      .map((x) => Number.parseInt(x, 10))
      .filter((x) => Number.isFinite(x))
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

export function optimizePlan(instanceId: string): OptimizeMod[] {
  const instance = config().getInstance(instanceId)
  if (instance.loader !== 'fabric') return []
  return OPTIMIZE_MODS.filter((mod) => {
    if (mod.maxVersion && compareVersions(instance.mcVersion, mod.maxVersion) > 0) return false
    return true
  }).map(({ maxVersion, ...rest }) => rest)
}

export async function optimizeApply(
  instanceId: string,
  slugs: string[],
): Promise<{ installed: string[]; skipped: string[] }> {
  const cfg = config()
  const instance = cfg.getInstance(instanceId)
  if (instance.loader !== 'fabric') throw new Error('Оптимизация доступна только для сборок Fabric')
  await ensureInstanceDirs(instanceId)

  const progress = new Progress(`optimize:${instanceId}`, 'FPS Boost')
  const installed: string[] = []
  const skipped: string[] = []
  const visited = new Set<string>()

  try {
    progress.phase('mods', slugs.length)
    await mapLimit(slugs, 1, async (slug, i) => {
      try {
        const project = await getProject(slug)
        await installModFile(instance, project.id, progress, visited, installed, skipped)
      } catch (e) {
        skipped.push(`${slug}: ${(e as Error).message}`)
      }
      progress.set(i + 1, slugs.length, `Обработано ${i + 1} / ${slugs.length}`)
    })
    progress.done(`Установлено: ${installed.length}`)
    return { installed, skipped }
  } catch (e) {
    progress.fail((e as Error).message)
    throw e
  }
}

export async function instanceModsCount(instanceId: string): Promise<number> {
  try {
    const entries = await fs.promises.readdir(p.instanceMods(instanceId))
    return entries.filter((f) => /\.jar$/i.test(f)).length
  } catch {
    return 0
  }
}
