import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DownloadAbortedError, type DownloadController } from './downloads'
import { ensureDir, exists, fileSize } from './fsutil'

export const USER_AGENT = 'RelaxLauncher/0.1.0 (Minecraft launcher; +https://modrinth.com)'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function sha1File(file: string): Promise<string | null> {
  if (!(await exists(file))) return null
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export interface JsonOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}

export async function fetchJson<T>(url: string, opts: JsonOptions = {}): Promise<T> {
  const { timeoutMs = 30000, retries = 2, headers = {}, signal } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        signal: signal ? anySignal([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = new Error(`HTTP ${res.status} ${res.statusText} — ${url}${body ? `\n${body.slice(0, 300)}` : ''}`)
        if (res.status === 404 || res.status === 400) throw err
        lastError = err
        if (res.status === 429 || res.status >= 500) {
          await sleep(500 * (attempt + 1))
          continue
        }
        throw err
      }
      return (await res.json()) as T
    } catch (e) {
      if (signal?.aborted) throw new DownloadAbortedError()
      lastError = e
      if (attempt < retries) await sleep(400 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export interface DownloadOptions {
  sha1?: string
  size?: number
  onBytes?: (received: number, total: number) => void
  retries?: number
  controller?: DownloadController
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

const inflight = new Map<string, Promise<void>>()

/**
 * Скачивает файл с проверкой SHA-1 и повторами.
 * Если файл уже на месте и хеш совпадает — ничего не делает.
 */
export function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  // В индексе ресурсов бывают разные имена с одинаковым хешем — не качаем один файл дважды.
  const key = path.resolve(dest).toLowerCase()
  const running = inflight.get(key)
  if (running) return running
  const task = downloadFileInner(url, dest, opts).finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

async function downloadFileInner(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const { sha1, size, onBytes, retries = 3, controller } = opts
  await controller?.gate()
  await ensureDir(path.dirname(dest))

  if (sha1) {
    const actualSize = await fileSize(dest)
    if (actualSize >= 0) {
      // Быстрая проверка: совпал размер — считаем файл целым (не читаем гигабайты с диска).
      if (size && actualSize === size) {
        onBytes?.(size, size)
        return
      }
      // Размер неизвестен — проверяем хеш.
      if (!size) {
        const actual = await sha1File(dest)
        if (actual === sha1) {
          onBytes?.(actualSize, actualSize)
          return
        }
      }
    }
  } else if (await exists(dest)) {
    const actualSize = await fileSize(dest)
    if (!size || actualSize === size) {
      onBytes?.(size ?? actualSize, size ?? actualSize)
      return
    }
  }

  const tmp = `${dest}.${process.pid}-${Math.random().toString(36).slice(2)}.part`
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await controller?.gate()
      await fs.promises.rm(tmp, { force: true })
      const signal = controller
        ? anySignal([controller.signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000)
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
      }
      const total = Number(res.headers.get('content-length')) || size || 0
      let received = 0
      const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
      const detach = controller?.attach(stream)
      stream.on('data', (chunk: Buffer) => {
        received += chunk.length
        onBytes?.(received, total)
      })
      try {
        await pipeline(stream, createWriteStream(tmp))
      } finally {
        detach?.()
      }
      await controller?.gate()
      if (sha1) {
        const actual = await sha1File(tmp)
        if (actual !== sha1) throw new Error(`Проверка SHA-1 не пройдена: ${path.basename(dest)}`)
      }
      await controller?.gate()
      if (controller?.aborted) throw new DownloadAbortedError()
      await fs.promises.rename(tmp, dest)
      return
    } catch (e) {
      if (controller?.aborted || e instanceof DownloadAbortedError) throw new DownloadAbortedError()
      lastError = e
      await fs.promises.rm(tmp, { force: true }).catch(() => {})
      if (attempt < retries) await sleep(600 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Не удалось скачать ${url}`)
}

/** Параллельная обработка массива с ограничением и прогрессом. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  let done = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const current = index++
      if (current >= items.length) return
      results[current] = await fn(items[current], current)
      done++
      onProgress?.(done, items.length)
    }
  })
  await Promise.all(workers)
  return results
}
