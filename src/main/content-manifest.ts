import fs from 'node:fs'
import path from 'node:path'
import type { ContentKind } from '../shared/types'
import { ensureDir } from './fsutil'
import { p } from './paths'

/**
 * Учёт скачанного контента сборки.
 *
 * Modrinth отдаёт файлы без project id, а по имени файла проект угадывается
 * ненадёжно (`sodium-extra` начинается с `sodium`). Поэтому при установке
 * через лаунчер записываем соответствие «файл → проект» рядом со сборкой,
 * чтобы каталог мог показать «Скачано» и кнопку удаления.
 */
export interface ContentRecord {
  /** Имя файла в папке контента, без суффикса `.disabled`. */
  file: string
  title: string
  installedAt: number
}

type Manifest = Partial<Record<ContentKind, Record<string, ContentRecord>>>

const KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader']

/** Кеш в памяти, чтобы не читать манифест на каждый мод в списке. */
const cache = new Map<string, Manifest>()
const chains = new Map<string, Promise<unknown>>()

export function baseContentFile(file: string): string {
  return file.replace(/\.disabled$/i, '')
}

function manifestPath(instanceId: string): string {
  return path.join(p.instance(instanceId), '.relax', 'content.json')
}

function normalize(raw: unknown): Manifest {
  const out: Manifest = {}
  if (!raw || typeof raw !== 'object') return out
  for (const kind of KINDS) {
    const section = (raw as Record<string, unknown>)[kind]
    if (!section || typeof section !== 'object') continue
    const clean: Record<string, ContentRecord> = {}
    for (const [projectId, value] of Object.entries(section as Record<string, unknown>)) {
      if (!projectId || !value || typeof value !== 'object') continue
      const record = value as Partial<ContentRecord>
      if (typeof record.file !== 'string' || !record.file) continue
      clean[projectId] = {
        file: baseContentFile(record.file),
        title: typeof record.title === 'string' ? record.title : projectId,
        installedAt: Number.isFinite(record.installedAt) ? Number(record.installedAt) : Date.now(),
      }
    }
    if (Object.keys(clean).length > 0) out[kind] = clean
  }
  return out
}

async function readManifest(instanceId: string): Promise<Manifest> {
  const cached = cache.get(instanceId)
  if (cached) return cached
  let data: Manifest = {}
  try {
    const raw = JSON.parse(await fs.promises.readFile(manifestPath(instanceId), 'utf8')) as unknown
    data = normalize(raw)
  } catch {
    /* манифеста ещё нет или он повреждён — начинаем с чистого */
  }
  cache.set(instanceId, data)
  return data
}

async function writeManifest(instanceId: string, data: Manifest): Promise<void> {
  cache.set(instanceId, data)
  const file = manifestPath(instanceId)
  const tmp = `${file}.part`
  try {
    await ensureDir(path.dirname(file))
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await fs.promises.rename(tmp, file)
  } catch {
    // Манифест — вспомогательный: без него лаунчер работает, просто не знает,
    // что уже скачано, и предложит установить повторно.
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
  }
}

/** Сериализует read-modify-write, чтобы параллельная установка не теряла записи. */
function enqueue<T>(instanceId: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(instanceId) ?? Promise.resolve()
  const next = previous.then(task, task)
  chains.set(
    instanceId,
    next.catch(() => {}),
  )
  return next
}

export async function rememberContent(
  instanceId: string,
  kind: ContentKind,
  projectId: string,
  file: string,
  title: string,
): Promise<void> {
  if (!projectId || !file) return
  await enqueue(instanceId, async () => {
    const data = await readManifest(instanceId)
    const section = { ...(data[kind] ?? {}) }
    section[projectId] = { file: baseContentFile(file), title, installedAt: Date.now() }
    await writeManifest(instanceId, { ...data, [kind]: section })
  }).catch(() => {})
}

export async function forgetContent(
  instanceId: string,
  kind: ContentKind,
  file: string,
): Promise<void> {
  const target = baseContentFile(file)
  await enqueue(instanceId, async () => {
    const data = await readManifest(instanceId)
    const section = data[kind]
    if (!section) return
    const next: Record<string, ContentRecord> = {}
    let changed = false
    for (const [projectId, record] of Object.entries(section)) {
      if (record.file === target) {
        changed = true
        continue
      }
      next[projectId] = record
    }
    if (!changed) return
    await writeManifest(instanceId, { ...data, [kind]: next })
  }).catch(() => {})
}

/** Карта «имя файла → project id» для папки контента. */
export async function contentProjectMap(
  instanceId: string,
  kind: ContentKind,
): Promise<Map<string, string>> {
  const data = await readManifest(instanceId)
  const map = new Map<string, string>()
  for (const [projectId, record] of Object.entries(data[kind] ?? {})) {
    map.set(record.file, projectId)
  }
  return map
}

/** Сбрасывает кеш при удалении сборки, чтобы не держать мусор в памяти. */
export function forgetInstanceContent(instanceId: string): void {
  cache.delete(instanceId)
  chains.delete(instanceId)
}
