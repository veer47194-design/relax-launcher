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

/**
 * Имя вроде `[1.20.1] SecurityCraft.jar` превращается в Java-модуль `_1._20._1`
 * и конфликтует с модулем `minecraft` (ResolutionException при старте Forge).
 * Убираем ведущий тег версии и квадратные скобки, остальное имя сохраняем.
 */
export function safeContentFileName(input: string): string {
  const base = path.basename(input)
  let out = base
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .replace(/[\[\]]/g, '-')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!out || /^\./.test(out) || !/\.(jar|zip)(\.disabled)?$/i.test(out)) {
    out = base.replace(/[\[\]]/g, '-').replace(/\s{2,}/g, ' ').trim()
  }
  if (!out || /^\./.test(out)) {
    out = `mod-${base.replace(/[^a-z0-9._-]+/gi, '-')}`
  }
  return out
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

/**
 * Проверяет version JSON перед повторным использованием.
 * Обрезанный при краше файл иначе принимался за рабочую версию,
 * и запуск падал с непонятной ошибкой.
 */
export async function validVersionJson(file: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(file, 'utf8')) as {
      id?: unknown
      mainClass?: unknown
      inheritsFrom?: unknown
      libraries?: unknown
    }
    return (
      typeof raw.id === 'string' &&
      raw.id.length > 0 &&
      (typeof raw.mainClass === 'string' || typeof raw.inheritsFrom === 'string') &&
      (raw.libraries === undefined || Array.isArray(raw.libraries))
    )
  } catch {
    return false
  }
}
