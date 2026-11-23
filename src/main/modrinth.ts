import type { Loader, MrProject, MrSearchResult, MrVersion, SearchParams } from '../shared/types'
import { fetchJson } from './http'

const API = 'https://api.modrinth.com/v2'

function facetsFor(params: SearchParams): string {
  const groups: string[][] = [[`project_type:${params.type}`]]
  if (params.gameVersion) groups.push([`versions:${params.gameVersion}`])
  if (params.loader && params.loader !== 'vanilla' && (params.type === 'mod' || params.type === 'modpack')) {
    groups.push([`categories:${params.loader}`])
  }
  return JSON.stringify(groups)
}

export async function searchProjects(params: SearchParams): Promise<MrSearchResult> {
  const limit = Math.max(1, Math.min(100, params.limit ?? 24))
  const offset = Math.max(0, params.offset ?? 0)
  const query = new URLSearchParams({
    query: params.query ?? '',
    limit: String(limit),
    offset: String(offset),
    index: params.sort ?? (params.query ? 'relevance' : 'downloads'),
    facets: facetsFor(params),
  })
  return fetchJson<MrSearchResult>(`${API}/search?${query.toString()}`, { retries: 2 })
}

export async function getProject(idOrSlug: string): Promise<MrProject> {
  return fetchJson<MrProject>(`${API}/project/${encodeURIComponent(idOrSlug)}`, { retries: 2 })
}

export async function getVersion(versionId: string): Promise<MrVersion> {
  return fetchJson<MrVersion>(`${API}/version/${encodeURIComponent(versionId)}`, { retries: 2 })
}

export async function getVersions(projectId: string, gameVersion?: string, loader?: Loader): Promise<MrVersion[]> {
  const query = new URLSearchParams()
  if (gameVersion) query.set('game_versions', JSON.stringify([gameVersion]))
  if (loader && loader !== 'vanilla') query.set('loaders', JSON.stringify([loader]))
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return fetchJson<MrVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version${suffix}`, { retries: 2 })
}

export function pickFile(version: MrVersion) {
  return version.files.find((f) => f.primary) ?? version.files[0]
}

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} тыс`
  return String(n)
}
