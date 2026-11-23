import type { VersionJson } from '../shared/types'
import { exists } from './fsutil'
import { fetchJson } from './http'
import { saveVersionJson } from './mojang'
import { p } from './paths'
import path from 'node:path'

const FABRIC_META = 'https://meta.fabricmc.net/v2'

export interface FabricLoader {
  version: string
  stable: boolean
}

const loaderCache = new Map<string, FabricLoader[]>()

export async function fabricLoaders(mcVersion: string): Promise<FabricLoader[]> {
  const cached = loaderCache.get(mcVersion)
  if (cached) return cached
  const raw = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(
    `${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}`,
  )
  const list = raw.map((x) => ({ version: x.loader.version, stable: !!x.loader.stable }))
  loaderCache.set(mcVersion, list)
  return list
}

export async function latestStableLoader(mcVersion: string): Promise<string> {
  const list = await fabricLoaders(mcVersion)
  if (list.length === 0) throw new Error(`Fabric пока не поддерживает Minecraft ${mcVersion}`)
  return (list.find((l) => l.stable) ?? list[0]).version
}

/** Скачивает профиль Fabric и сохраняет его как отдельную версию. */
export async function ensureFabricVersion(mcVersion: string, loaderVersion?: string): Promise<{ id: string; loader: string }> {
  const loader = loaderVersion || (await latestStableLoader(mcVersion))
  const id = `fabric-loader-${loader}-${mcVersion}`
  const local = path.join(p.version(id), `${id}.json`)
  if (await exists(local)) return { id, loader }
  try {
    const profile = await fetchJson<VersionJson>(
      `${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`,
      { retries: 3 },
    )
    profile.id = id
    profile.inheritsFrom = mcVersion
    await saveVersionJson(profile)
  } catch (e) {
    throw new Error(`Не удалось получить профиль Fabric ${loader} для ${mcVersion}: ${(e as Error).message}`)
  }
  return { id, loader }
}

export function fabricVersionId(mcVersion: string, loader: string): string {
  return `fabric-loader-${loader}-${mcVersion}`
}
