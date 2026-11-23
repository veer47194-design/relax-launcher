import fs from 'node:fs'
import path from 'node:path'

export async function ensureDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true })
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file)
    return true
  } catch {
    return false
  }
}

export async function fileSize(file: string): Promise<number> {
  try {
    return (await fs.promises.stat(file)).size
  } catch {
    return -1
  }
}

export function safeJoin(base: string, relative: string): string {
  const clean = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  const target = path.resolve(base, clean)
  const rootResolved = path.resolve(base)
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`Небезопасный путь: ${relative}`)
  }
  return target
}

export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
