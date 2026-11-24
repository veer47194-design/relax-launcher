import fs from 'node:fs'
import path from 'node:path'
import type { CacheInfo } from '../shared/types'
import { hasActiveDownloads } from './downloads'
import { hasActiveTransfers } from './http'
import { isModpackInstalling } from './modpack'
import { p } from './paths'

const SKIP_DIRS = new Set(['runtime'])

async function walk(dir: string, visit: (file: string, stat: fs.Stats) => void | Promise<void>): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(full, visit)
    } else if (entry.isFile()) {
      try {
        await visit(full, await fs.promises.stat(full))
      } catch {
        /* файл мог исчезнуть */
      }
    }
  }
}

export async function getCacheInfo(): Promise<CacheInfo> {
  const info: CacheInfo = {
    totalBytes: 0,
    partsBytes: 0,
    partsFiles: 0,
    installersBytes: 0,
    installersFiles: 0,
    modpacksBytes: 0,
    modpacksFiles: 0,
    otherBytes: 0,
  }

  await walk(p.root(), (file, stat) => {
    if (file.toLowerCase().endsWith('.part')) {
      info.partsBytes += stat.size
      info.partsFiles++
      return
    }
  })

  const cacheDir = p.cache()
  await walk(cacheDir, (file, stat) => {
    const name = path.basename(file).toLowerCase()
    if (name.endsWith('-installer.jar')) {
      info.installersBytes += stat.size
      info.installersFiles++
    } else if (name.endsWith('.mrpack')) {
      info.modpacksBytes += stat.size
      info.modpacksFiles++
    } else {
      info.otherBytes += stat.size
    }
  })

  info.totalBytes = info.partsBytes + info.installersBytes + info.modpacksBytes + info.otherBytes
  return info
}

/** Удаляет только то, что можно скачать заново. Java-рантаймы и authlib-injector не трогаем. */
export async function clearCache(): Promise<CacheInfo> {
  // Удаление .part/.mrpack во время установки ломало rename и чтение архива.
  if (hasActiveDownloads() || hasActiveTransfers() || isModpackInstalling()) {
    throw new Error('Дождитесь окончания установки или загрузки — кеш занят')
  }
  const before = await getCacheInfo()

  await walk(p.root(), async (file) => {
    if (file.toLowerCase().endsWith('.part')) {
      await fs.promises.rm(file, { force: true }).catch(() => {})
    }
  })

  const forgeDir = path.join(p.cache(), 'forge')
  await walk(forgeDir, async (file) => {
    if (path.basename(file).toLowerCase().endsWith('-installer.jar')) {
      await fs.promises.rm(file, { force: true }).catch(() => {})
    }
  })

  const modpackDir = path.join(p.cache(), 'modpacks')
  await walk(modpackDir, async (file) => {
    if (path.basename(file).toLowerCase().endsWith('.mrpack')) {
      await fs.promises.rm(file, { force: true }).catch(() => {})
    }
  })

  const after = await getCacheInfo()
  return {
    ...after,
    totalBytes: Math.max(0, before.totalBytes - after.totalBytes),
  }
}
