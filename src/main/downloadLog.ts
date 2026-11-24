import type { DownloadRecord, ProgressEvent } from '../shared/types'

const MAX_RECORDS = 80
let records: DownloadRecord[] = []
const listeners = new Set<(records: DownloadRecord[]) => void>()

function snapshot(): DownloadRecord[] {
  return records.map((record) => ({ ...record }))
}

let notifyTimer: NodeJS.Timeout | null = null
let dirty = false

function flush() {
  dirty = false
  const data = snapshot()
  for (const listener of listeners) listener(data)
}

/** Прогресс приходит десятки раз в секунду — рассылаем список не чаще 4 раз в секунду. */
function notify(immediate = false) {
  if (immediate) {
    if (notifyTimer) {
      clearTimeout(notifyTimer)
      notifyTimer = null
    }
    flush()
    return
  }
  dirty = true
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    if (dirty) flush()
  }, 250)
}

export function onDownloadsChange(cb: (records: DownloadRecord[]) => void): () => void {
  listeners.add(cb)
  cb(snapshot())
  return () => listeners.delete(cb)
}

export function listDownloads(): DownloadRecord[] {
  return snapshot()
}

function kindOf(id: string): string {
  if (id.startsWith('install:')) return 'Версия'
  if (id.startsWith('launch:')) return 'Запуск'
  if (id.startsWith('mod:')) return 'Мод'
  if (id.startsWith('modpack:')) return 'Сборка'
  if (id.startsWith('optimize:')) return 'Оптимизация'
  if (id.startsWith('forge:')) return 'Forge'
  if (id.startsWith('ely:')) return 'Ely.by'
  return 'Загрузка'
}

export function recordProgress(event: ProgressEvent): void {
  const terminal = event.done
    ? event.error
      ? 'error'
      : /остановлено|cancelled/i.test(event.detail ?? '')
        ? 'cancelled'
        : 'done'
    : null

  let record = records.find((r) => r.id === event.id)
  if (!record || (terminal && record.status !== 'active' && record.status !== 'paused')) {
    if (record) records = records.filter((r) => r.id !== event.id)
    record = {
      id: event.id,
      title: event.title,
      kind: kindOf(event.id),
      status: event.error ? 'error' : 'active',
      current: event.current,
      total: event.total,
      detail: event.detail,
      error: event.error,
      startedAt: Date.now(),
    }
    records.unshift(record)
  }

  record.current = event.current
  record.total = event.total
  if (event.detail !== undefined) record.detail = event.detail
  if (event.error) record.error = event.error
  if (!event.done && !event.error && record.status !== 'paused') record.status = 'active'
  if (terminal) {
    record.status = terminal
    record.finishedAt = Date.now()
  }

  if (records.length > MAX_RECORDS) records = records.slice(0, MAX_RECORDS)
  notify()
}

export function setDownloadPaused(id: string, paused: boolean): void {
  const record = records.find((r) => r.id === id)
  if (!record || record.status === 'done' || record.status === 'error' || record.status === 'cancelled') return
  record.status = paused ? 'paused' : 'active'
  notify(true)
}

export function clearDownloadHistory(): void {
  records = records.filter((r) => r.status === 'active' || r.status === 'paused')
  notify(true)
}
