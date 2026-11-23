import fs from 'node:fs'
import path from 'node:path'
import type { ScreenshotInfo } from '../shared/types'
import { config } from './config'
import { p } from './paths'

const IMAGE_RE = /\.(png|jpe?g|webp)$/i

export function screenshotsDir(instanceId: string): string {
  config().getInstance(instanceId)
  return path.join(p.instance(instanceId), 'screenshots')
}

export function screenshotUrl(instanceId: string, file: string, modified: number): string {
  return `relax-shot://local/${encodeURIComponent(instanceId)}/${encodeURIComponent(file)}?v=${Math.floor(modified)}`
}

export async function listScreenshots(instanceId: string): Promise<ScreenshotInfo[]> {
  const dir = screenshotsDir(instanceId)
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: ScreenshotInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE_RE.test(entry.name)) continue
    try {
      const stat = await fs.promises.stat(path.join(dir, entry.name))
      out.push({
        file: entry.name,
        size: stat.size,
        modified: stat.mtimeMs,
        url: screenshotUrl(instanceId, entry.name, stat.mtimeMs),
      })
    } catch {
      /* файл могли удалить */
    }
  }
  return out.sort((a, b) => b.modified - a.modified)
}

/** Возвращает абсолютный путь, отклоняя любые попытки выйти за папку скриншотов. */
export function resolveScreenshot(instanceId: string, file: string): string {
  const dir = path.resolve(screenshotsDir(instanceId))
  const base = path.basename(String(file))
  if (base !== file || !IMAGE_RE.test(base)) throw new Error('Недопустимый файл скриншота')
  const full = path.resolve(dir, base)
  if (full !== path.join(dir, base) || !full.startsWith(dir + path.sep)) {
    throw new Error('Недопустимый путь к скриншоту')
  }
  return full
}

export async function removeScreenshot(instanceId: string, file: string): Promise<void> {
  const full = resolveScreenshot(instanceId, file)
  await fs.promises.rm(full, { force: true })
}
