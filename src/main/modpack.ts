import fs from 'node:fs'
import path from 'node:path'
import type { Instance, Loader, ModpackInstallResult } from '../shared/types'
import { config, ensureInstanceDirs } from './config'
import { ensureDir, safeJoin } from './fsutil'
import { downloadFile, mapLimit } from './http'
import { fabricLoaders, latestStableLoader } from './fabric'
import { forgeLoaders, latestForgeLoader } from './forge'
import { getProject, getVersions, pickFile } from './modrinth'
import { p } from './paths'
import { Progress } from './progress'
import { extractZip, listZip, readZipFile } from './zip'

interface MrpackFile {
  path: string
  hashes?: { sha1?: string; sha512?: string }
  env?: { client?: 'required' | 'optional' | 'unsupported'; server?: 'required' | 'optional' | 'unsupported' }
  downloads?: string[]
  fileSize?: number
}

interface MrpackIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: MrpackFile[]
  dependencies: Record<string, string>
}

const LOADER_NAMES: Record<string, string> = {
  forge: 'Forge',
  neoforge: 'NeoForge',
  'quilt-loader': 'Quilt',
}

export interface ModpackSource {
  projectId?: string
  versionId?: string
  title?: string
  iconUrl?: string
  fallbackName?: string
}

async function installFromMrpack(
  mrpackPath: string,
  progress: Progress,
  source: ModpackSource,
): Promise<ModpackInstallResult> {
  const cfg = config()
  let created: Instance | null = null

  try {
    progress.phase('prepare')
    progress.note('Чтение modrinth.index.json')
    let indexRaw = readZipFile(mrpackPath, 'modrinth.index.json')
    if (!indexRaw) {
      const entry = listZip(mrpackPath).find((e) => e.name.endsWith('modrinth.index.json'))
      if (entry) indexRaw = entry.data
    }
    if (!indexRaw) throw new Error('В архиве сборки нет modrinth.index.json — это не .mrpack?')
    const index = JSON.parse(indexRaw.toString('utf8')) as MrpackIndex
    if (index.game && index.game !== 'minecraft') {
      throw new Error(`Неизвестный тип сборки: ${index.game}`)
    }

    const mcVersion = index.dependencies?.minecraft
    if (!mcVersion) throw new Error('Сборка не указывает версию Minecraft')

    let loader: Loader = 'vanilla'
    let loaderVersion: string | undefined
    for (const [key, display] of Object.entries(LOADER_NAMES)) {
      if (key === 'forge') continue
      if (index.dependencies[key]) {
        throw new Error(
          `Сборка использует ${display}, а Relax Launcher пока поддерживает Vanilla, Fabric и Forge. Попробуйте другую сборку.`,
        )
      }
    }
    if (index.dependencies['forge']) {
      loader = 'forge'
      const requested = index.dependencies['forge']
      const available = await forgeLoaders(mcVersion).catch(() => [])
      loaderVersion = available.some((l) => l.version === requested)
        ? requested
        : await latestForgeLoader(mcVersion).catch(() => requested)
    } else if (index.dependencies['fabric-loader']) {
      loader = 'fabric'
      const requested = index.dependencies['fabric-loader']
      const available = await fabricLoaders(mcVersion).catch(() => [])
      loaderVersion = available.some((l) => l.version === requested)
        ? requested
        : await latestStableLoader(mcVersion)
    }

    const name = (index.name || source.title || source.fallbackName || 'Сборка Modrinth').slice(0, 60)
    created = cfg.createInstance({
      name,
      mcVersion,
      loader,
      loaderVersion,
      icon: source.projectId ? '📦' : '🧩',
      modpack: source.projectId
        ? {
            projectId: source.projectId,
            versionId: source.versionId ?? index.versionId ?? 'local',
            name: source.title ?? name,
            iconUrl: source.iconUrl,
          }
        : undefined,
    })
    await ensureInstanceDirs(created.id)
    const instanceDir = p.instance(created.id)

    const files = (index.files ?? []).filter(
      (f) => f.env?.client !== 'unsupported' && f.downloads && f.downloads.length > 0,
    )

    progress.phase('files', files.length)
    let downloaded = 0
    await mapLimit(
      files,
      8,
      async (f) => {
        const target = safeJoin(instanceDir, f.path)
        await ensureDir(path.dirname(target))
        await downloadFile(f.downloads![0], target, { sha1: f.hashes?.sha1, size: f.fileSize })
        downloaded++
      },
      (n, total) => progress.set(n, total, `Файлы сборки ${n} / ${total}`),
    )

    progress.phase('overrides')
    progress.note('Распаковка overrides')
    const extracted = await extractZip(mrpackPath, instanceDir, {
      prefix: 'overrides/',
      extraPrefixes: ['client-overrides/'],
      onProgress: (n, total) => progress.set(n, total, `Файлы сборки ${n} / ${total}`),
    })

    progress.done(`Установлено файлов: ${downloaded}${extracted ? `, overrides: ${extracted}` : ''}`)
    return { instance: created, files: downloaded + extracted }
  } catch (e) {
    if (created) {
      cfg.removeInstance(created.id)
      await fs.promises.rm(p.instance(created.id), { recursive: true, force: true }).catch(() => {})
    }
    progress.fail((e as Error).message)
    throw e
  }
}

export async function installModpack(projectId: string): Promise<ModpackInstallResult> {
  const progress = new Progress(`modpack:${projectId}`, 'Установка сборки')

  try {
    progress.phase('prepare')
    progress.note('Поиск версии сборки')
    const project = await getProject(projectId)
    const versions = await getVersions(project.id)
    if (versions.length === 0) throw new Error(`У сборки «${project.title}» нет доступных версий`)
    const version = versions[0]
    const file = pickFile(version)
    if (!file) throw new Error('У версии сборки нет файла для скачивания')

    progress.phase('download')
    progress.note(`Скачивание «${project.title}»`)
    const cacheDir = path.join(p.cache(), 'modpacks')
    await ensureDir(cacheDir)
    const safeSlug = (project.slug || project.id).replace(/[^a-z0-9._-]+/gi, '-')
    const mrpackPath = path.join(cacheDir, `${safeSlug}-${version.id}.mrpack`)
    await downloadFile(file.url, mrpackPath, { sha1: file.hashes.sha1, size: file.size })

    return await installFromMrpack(mrpackPath, progress, {
      projectId: project.id,
      versionId: version.id,
      title: project.title,
      iconUrl: project.icon_url ?? undefined,
      fallbackName: project.title,
    })
  } catch (e) {
    progress.fail((e as Error).message)
    throw e
  }
}

export async function installModpackFile(filePath: string): Promise<ModpackInstallResult> {
  const resolved = path.resolve(filePath)
  const stat = await fs.promises.stat(resolved).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error('Файл сборки не найден')
  if (!/\.mrpack$/i.test(resolved)) throw new Error('Поддерживаются только файлы .mrpack')

  const progress = new Progress(`modpack:file:${path.basename(resolved)}`, 'Импорт сборки .mrpack')
  return installFromMrpack(resolved, progress, {
    fallbackName: path.basename(resolved, path.extname(resolved)),
  })
}
