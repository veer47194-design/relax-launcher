import fs from 'node:fs'
import path from 'node:path'
import type { Instance } from '../shared/types'
import { p } from './paths'
import type { Progress } from './progress'
import { writeZip, type ZipWriteEntry } from './zip'

export interface InstanceExportOptions {
  /** Добавить папку saves с мирами. */
  includeSaves?: boolean
  /** Добавить папку screenshots. */
  includeScreenshots?: boolean
}

export interface InstanceExportResult {
  file: string
  files: number
  bytes: number
}

/** Папки, которые имеет смысл переносить между лаунчерами. */
const CONTENT_DIRS = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'scripts']

const ROOT_FILES = [
  'options.txt',
  'optionsof.txt',
  'servers.dat',
  'servers.dat_old',
  'realms_persistence.json',
  'iris.properties',
  'sodium-options.json',
  'sodium-fingerprint.json',
  'xaero-waypoints.json',
]

const SKIP_NAMES = new Set([
  '.git',
  '.svn',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '__MACOSX',
  '.cache',
  'natives',
])

interface CollectedFile {
  rel: string
  abs: string
  size: number
  mtime: Date
}

async function collectDir(base: string, relDir: string, out: CollectedFile[]) {
  const full = path.join(base, relDir)
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(full, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue
    if (entry.isSymbolicLink()) continue
    const rel = `${relDir}/${entry.name}`.replace(/\\/g, '/')
    const abs = path.join(full, entry.name)
    if (entry.isDirectory()) {
      await collectDir(base, rel, out)
    } else if (entry.isFile()) {
      try {
        const stat = await fs.promises.stat(abs)
        out.push({ rel, abs, size: stat.size, mtime: stat.mtime })
      } catch {
        /* файл могли удалить во время экспорта */
      }
    }
  }
}

export async function exportInstance(
  instance: Instance,
  targetFile: string,
  options: InstanceExportOptions,
  progress: Progress,
): Promise<InstanceExportResult> {
  const base = p.instance(instance.id)
  progress.phase('prepare', 1)
  progress.note('Чтение списка файлов')

  const files: CollectedFile[] = []
  const dirs = [...CONTENT_DIRS]
  if (options.includeSaves) dirs.push('saves')
  if (options.includeScreenshots) dirs.push('screenshots')

  for (const dir of dirs) await collectDir(base, dir, files)

  for (const name of ROOT_FILES) {
    const abs = path.join(base, name)
    try {
      const stat = await fs.promises.stat(abs)
      if (stat.isFile()) files.push({ rel: name, abs, size: stat.size, mtime: stat.mtime })
    } catch {
      /* необязательный файл */
    }
  }

  const manifest = {
    format: 'relax-pack',
    formatVersion: 1,
    createdAt: Date.now(),
    name: instance.name,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion ?? null,
    icon: instance.icon,
    modpack: instance.modpack ?? null,
    includesSaves: !!options.includeSaves,
    files: files.length,
  }

  const entries: ZipWriteEntry[] = [
    {
      name: 'relax-pack.json',
      data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      mtime: new Date(),
    },
    ...files.map((file) => ({ name: file.rel, file: file.abs, mtime: file.mtime })),
  ]

  const total = entries.length
  progress.phase('export', total)
  progress.set(0, total, `0 / ${total}`)

  const result = await writeZip(targetFile, entries, {
    onProgress: (done, all, name) => {
      progress.set(done, all, `${done} / ${all} · ${path.posix.basename(name)}`)
    },
  })

  return { file: targetFile, files: result.files, bytes: result.bytes }
}
