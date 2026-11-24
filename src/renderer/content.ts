import type { ModInfo, MrSearchHit } from '../shared/types'

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Ищет скачанный файл, соответствующий проекту Modrinth.
 *
 * Основной путь — id проекта из манифеста лаунчера. Для модов, приехавших
 * внутри модпака (или установленных до появления манифеста), сравниваем
 * нормализованные названия: `sodium extra` → `sodiumextra` = slug `sodium-extra`.
 */
export function findInstalledContent(hit: MrSearchHit, list: ModInfo[]): ModInfo | undefined {
  const byId = list.find((item) => item.projectId === hit.project_id)
  if (byId) return byId
  const keys = new Set([normalize(hit.slug), normalize(hit.title)])
  keys.delete('')
  if (keys.size === 0) return undefined
  return list.find((item) => !item.projectId && keys.has(normalize(item.name)))
}
