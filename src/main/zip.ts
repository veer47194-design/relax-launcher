import fs from 'node:fs'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { FileHandle } from 'node:fs/promises'
import { ensureDir, safeJoin } from './fsutil'

export interface ZipEntry {
  name: string
  isDir: boolean
  size: number
  data: Buffer
}

interface RawEntry {
  name: string
  isDir: boolean
  method: number
  compressedSize: number
  size: number
  dataStart: number
}

function readEntries(buf: Buffer): RawEntry[] {
  let eocd = -1
  const stop = Math.max(0, buf.length - 65558)
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Повреждённый ZIP-архив (не найден EOCD)')

  const count = buf.readUInt16LE(eocd + 10)
  if (count === 0xffff) throw new Error('ZIP64 не поддерживается')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset < 0 || cdOffset + 46 > buf.length) throw new Error('Повреждённый ZIP-архив (смещение центральной папки)')

  const entries: RawEntry[] = []
  let offset = cdOffset
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length) throw new Error('Повреждённый ZIP-архив (обрезанная центральная папка)')
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('Повреждённый ZIP-архив (центральная папка)')
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const size = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    if (offset + 46 + nameLen > buf.length) throw new Error('Повреждённый ZIP-архив (имя файла)')
    const rawName = buf.subarray(offset + 46, offset + 46 + nameLen)
    const name = rawName.toString('utf8').replace(/\\/g, '/')

    if (localOffset + 30 > buf.length) throw new Error('Повреждённый ZIP-архив (локальный заголовок)')
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Повреждённый ZIP-архив (локальный заголовок)')
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (dataStart + compressedSize > buf.length) throw new Error('Повреждённый ZIP-архив (данные файла)')

    entries.push({ name, isDir: name.endsWith('/'), method, compressedSize, size, dataStart })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export async function listZip(file: string): Promise<ZipEntry[]> {
  const buf = await fs.promises.readFile(file)
  const raw = readEntries(buf)
  return raw.map((e) => ({
    name: e.name,
    isDir: e.isDir,
    size: e.size,
    data: e.isDir ? Buffer.alloc(0) : extractData(buf, e),
  }))
}

function extractData(buf: Buffer, entry: RawEntry): Buffer {
  const slice = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(slice)
  if (entry.method === 8) return inflateRawSync(slice)
  throw new Error(`Неподдерживаемый метод сжатия ZIP: ${entry.method}`)
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function readExact(fd: number, length: number, position: number): Buffer {
  const out = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const n = fs.readSync(fd, out, read, length - read, position + read)
    if (n <= 0) break
    read += n
  }
  return read === length ? out : out.subarray(0, read)
}

/**
 * Читает один файл из архива, не загружая его целиком:
 * сначала оглавление в конце файла, затем только нужную запись.
 */
export function readZipFile(file: string, entryName: string): Buffer | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    if (size < 22) return null

    const tailLen = Math.min(size, 65558)
    const tail = readExact(fd, tailLen, size - tailLen)
    const eocd = findEocd(tail)
    if (eocd < 0) throw new Error('Повреждённый ZIP-архив (не найден EOCD)')

    const count = tail.readUInt16LE(eocd + 10)
    if (count === 0xffff) throw new Error('ZIP64 не поддерживается')
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (cdOffset < 0 || cdOffset > size - 22) throw new Error('Повреждённый ZIP-архив (смещение центральной папки)')
    const cd = readExact(fd, size - cdOffset, cdOffset)
    const wanted = entryName.replace(/\\/g, '/')

    let p = 0
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) {
        throw new Error('Повреждённый ZIP-архив (центральная папка)')
      }
      const method = cd.readUInt16LE(p + 10)
      const compressedSize = cd.readUInt32LE(p + 20)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const localOffset = cd.readUInt32LE(p + 42)
      if (p + 46 + nameLen > cd.length) throw new Error('Повреждённый ZIP-архив (имя файла)')
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/')

      if (name === wanted) {
        const local = readExact(fd, 30, localOffset)
        if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) {
          throw new Error('Повреждённый ZIP-архив (локальный заголовок)')
        }
        const localNameLen = local.readUInt16LE(26)
        const localExtraLen = local.readUInt16LE(28)
        const data = readExact(fd, compressedSize, localOffset + 30 + localNameLen + localExtraLen)
        if (method === 0) return data
        if (method === 8) return inflateRawSync(data)
        throw new Error(`Неподдерживаемый метод сжатия ZIP: ${method}`)
      }
      p += 46 + nameLen + extraLen + commentLen
    }
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/* ------------------------------- Запись ZIP ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipWriteEntry {
  name: string
  /** Готовые данные записи. */
  data?: Buffer
  /** Либо путь к файлу — он будет прочитан по одному и сразу записан в архив. */
  file?: string
  mtime?: Date
}

export interface ZipWriteOptions {
  onProgress?: (done: number, total: number, name: string) => void
}

interface CentralRecord {
  name: Buffer
  crc: number
  size: number
  offset: number
  time: number
  date: number
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

async function writeAllAsync(handle: FileHandle, buf: Buffer) {
  let written = 0
  while (written < buf.length) {
    const { bytesWritten } = await handle.write(buf, written, buf.length - written)
    if (bytesWritten <= 0) throw new Error('Не удалось записать ZIP-архив')
    written += bytesWritten
  }
}

/**
 * Создаёт ZIP-архив методом store (без сжатия).
 * Моды, PNG и JAR уже сжаты, поэтому перепаковка только тратит время.
 * ZIP64 не поддерживается — архив ограничен 4 ГБ и 65535 файлами.
 */
export async function writeZip(
  file: string,
  entries: ZipWriteEntry[],
  opts: ZipWriteOptions = {},
): Promise<{ files: number; bytes: number }> {
  if (entries.length > 0xffff) throw new Error('Слишком много файлов для ZIP (максимум 65535)')

  // Считаем размер ДО открытия файла: иначе при превышении 4 ГБ пользователь
  // оставался с обрезанным архивом на месте прошлого файла.
  let estimate = 22
  for (const entry of entries) {
    let size = entry.data?.length
    if (size === undefined) {
      try {
        size = (await fs.promises.stat(entry.file!)).size
      } catch {
        throw new Error(`Файл исчез во время экспорта: ${entry.name}`)
      }
    }
    const nameLen = Buffer.byteLength(entry.name.replace(/\\/g, '/'))
    estimate += 30 + nameLen + size + 46 + nameLen
    if (estimate > 0xffffffff) throw new Error('Архив превышает 4 ГБ — ZIP64 не поддерживается')
  }

  const tmp = `${file}.part`
  const handle = await fs.promises.open(tmp, 'w')
  const central: CentralRecord[] = []
  let offset = 0
  let complete = false
  const total = entries.length

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const data = entry.data ?? (entry.file ? await fs.promises.readFile(entry.file) : Buffer.alloc(0))
      if (data.length > 0xffffffff) throw new Error(`Файл слишком большой для ZIP: ${entry.name}`)
      const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8')
      if (name.length > 0xffff) throw new Error(`Слишком длинное имя файла: ${entry.name}`)

      const { time, date } = dosDateTime(entry.mtime ?? new Date())
      const crc = crc32(data)
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(0x800, 6)
      header.writeUInt16LE(0, 8)
      header.writeUInt16LE(time, 10)
      header.writeUInt16LE(date, 12)
      header.writeUInt32LE(crc, 14)
      header.writeUInt32LE(data.length, 18)
      header.writeUInt32LE(data.length, 22)
      header.writeUInt16LE(name.length, 26)
      header.writeUInt16LE(0, 28)

      await writeAllAsync(handle, header)
      await writeAllAsync(handle, name)
      await writeAllAsync(handle, data)
      central.push({ name, crc, size: data.length, offset, time, date })
      offset += header.length + name.length + data.length
      opts.onProgress?.(i + 1, total, entry.name)
    }

    const cdStart = offset
    for (const rec of central) {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(0x800, 8)
      header.writeUInt16LE(0, 10)
      header.writeUInt16LE(rec.time, 12)
      header.writeUInt16LE(rec.date, 14)
      header.writeUInt32LE(rec.crc, 16)
      header.writeUInt32LE(rec.size, 20)
      header.writeUInt32LE(rec.size, 24)
      header.writeUInt16LE(rec.name.length, 28)
      header.writeUInt32LE(rec.offset, 42)
      await writeAllAsync(handle, header)
      await writeAllAsync(handle, rec.name)
      offset += header.length + rec.name.length
    }

    const cdSize = offset - cdStart
    if (cdSize > 0xffffffff || cdStart > 0xffffffff) {
      throw new Error('Архив превышает 4 ГБ — ZIP64 не поддерживается')
    }
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(central.length, 8)
    eocd.writeUInt16LE(central.length, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdStart, 16)
    await writeAllAsync(handle, eocd)
    offset += eocd.length
    complete = true
  } finally {
    await handle.close()
    if (complete) {
      await fs.promises.rename(tmp, file)
    } else {
      await fs.promises.rm(tmp, { force: true }).catch(() => {})
    }
  }

  return { files: central.length, bytes: offset }
}

function matchExclude(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('/')) {
      if (name.startsWith(pattern)) return true
    } else if (pattern.startsWith('*.')) {
      if (name.endsWith(pattern.slice(1))) return true
    } else if (pattern.startsWith('*')) {
      if (name.endsWith(pattern.slice(1))) return true
    } else if (name === pattern || name.startsWith(pattern)) {
      return true
    }
  }
  return false
}

export interface ExtractOptions {
  /** Оставить только записи с этим префиксом (он будет отрезан). */
  prefix?: string
  /** Дополнительный префикс, который тоже нужно обработать. */
  extraPrefixes?: string[]
  /** Пропускать записи по шаблонам. */
  exclude?: string[]
  onProgress?: (done: number, total: number) => void
}

export async function extractZip(zipFile: string, destDir: string, opts: ExtractOptions = {}): Promise<number> {
  const buf = await fs.promises.readFile(zipFile)
  const entries = readEntries(buf)
  const { prefix, extraPrefixes = [], exclude = [], onProgress } = opts

  const selected = entries
    .map((entry) => {
      let relative = entry.name
      let matched = false
      if (prefix) {
        if (relative.startsWith(prefix)) {
          relative = relative.slice(prefix.length)
          matched = true
        }
      } else {
        matched = true
      }
      for (const extra of extraPrefixes) {
        if (relative.startsWith(extra)) {
          relative = relative.slice(extra.length)
          matched = true
        }
      }
      return { entry, relative, matched }
    })
    .filter(({ entry, relative, matched }) => matched && relative.length > 0 && !matchExclude(entry.name, exclude))

  let done = 0
  for (const { entry, relative } of selected) {
    const target = safeJoin(destDir, relative)
    if (entry.isDir) {
      await ensureDir(target)
    } else {
      await ensureDir(path.dirname(target))
      await fs.promises.writeFile(target, extractData(buf, entry))
    }
    done++
    if (done % 25 === 0 || done === selected.length) onProgress?.(done, selected.length)
  }
  return done
}
