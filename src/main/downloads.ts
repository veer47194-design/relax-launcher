import type { Readable } from 'node:stream'

/** Пользователь остановил загрузку — не считаем это ошибкой и не повторяем запрос. */
export class DownloadAbortedError extends Error {
  constructor() {
    super('Загрузка остановлена')
    this.name = 'DownloadAbortedError'
  }
}

/**
 * Управление одной загрузкой: пауза, продолжение и отмена.
 * Пауза останавливает активные потоки и не даёт начать новые файлы.
 */
export class DownloadController {
  private readonly abortController = new AbortController()
  private paused = false
  private readonly waiters: Array<() => void> = []
  private readonly streams = new Set<Readable>()

  readonly signal = this.abortController.signal

  get aborted(): boolean {
    return this.abortController.signal.aborted
  }

  get isPaused(): boolean {
    return this.paused
  }

  pause(): void {
    if (this.paused || this.aborted) return
    this.paused = true
    for (const stream of this.streams) stream.pause()
  }

  resume(): void {
    if (!this.paused || this.aborted) return
    this.paused = false
    for (const stream of this.streams) stream.resume()
    this.flushWaiters()
  }

  cancel(): void {
    if (this.aborted) return
    this.abortController.abort()
    this.flushWaiters()
  }

  /** Ждёт, пока загрузка на паузе. При отмене выбрасывает DownloadAbortedError. */
  async gate(): Promise<void> {
    if (this.aborted) throw new DownloadAbortedError()
    if (!this.paused) return
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    if (this.aborted) throw new DownloadAbortedError()
  }

  attach(stream: Readable): () => void {
    this.streams.add(stream)
    if (this.paused) stream.pause()
    return () => this.streams.delete(stream)
  }

  private flushWaiters(): void {
    const waiters = this.waiters.splice(0)
    for (const resolve of waiters) resolve()
  }
}

const registry = new Map<string, DownloadController>()

export interface DownloadLease {
  controller: DownloadController
  /** false — задача уже идёт, этот вызов не владеет контроллером и не должен его удалять. */
  owned: boolean
}

export function beginDownload(id: string): DownloadLease {
  const existing = registry.get(id)
  if (existing && !existing.aborted) return { controller: existing, owned: false }
  const controller = new DownloadController()
  registry.set(id, controller)
  return { controller, owned: true }
}

export function hasActiveDownloads(): boolean {
  return registry.size > 0
}

export function getDownload(id: string): DownloadController | null {
  return registry.get(id) ?? null
}

export function endDownload(id: string): void {
  registry.delete(id)
}
