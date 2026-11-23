import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './paths'
import { ensureDir } from './fsutil'

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const MAX_SIZE = 40 * 1024 * 1024

export function backgroundsDir(): string {
  return path.join(configDir(), 'backgrounds')
}

export function backgroundPath(name: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(name)) return null
  const file = path.join(backgroundsDir(), name)
  if (path.dirname(file) !== backgroundsDir()) return null
  return file
}

/** Копирует выбранную картинку в папку конфига и возвращает её безопасное имя. */
export async function importBackground(source: string): Promise<string> {
  const stat = await fs.promises.stat(source).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error('Файл обоев не найден')
  const ext = path.extname(source).toLowerCase()
  if (!ALLOWED.has(ext)) {
    throw new Error('Поддерживаются изображения PNG, JPG, WEBP, GIF и AVIF')
  }
  if (stat.size > MAX_SIZE) throw new Error('Изображение больше 40 МБ — выберите файл поменьше')

  const dir = backgroundsDir()
  await ensureDir(dir)
  const name = `wallpaper-${Date.now()}${ext}`
  await fs.promises.copyFile(source, path.join(dir, name))

  // Старые обои больше не нужны.
  try {
    for (const entry of await fs.promises.readdir(dir)) {
      if (entry !== name) await fs.promises.rm(path.join(dir, entry), { force: true })
    }
  } catch {
    /* не критично */
  }
  return name
}

export async function clearBackgroundFile(name: string | null | undefined): Promise<void> {
  if (!name) return
  const file = backgroundPath(name)
  if (file) await fs.promises.rm(file, { force: true }).catch(() => {})
}
