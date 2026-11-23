import type { VersionManifest } from '../shared/types'

export const api = window.relax

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function errText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/^Error invoking remote method "[^"]+":\s*/i, '')
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} тыс`
  return String(n)
}

export function timeAgo(ts?: number): string {
  if (!ts) return 'ещё не запускалась'
  const diff = Date.now() - ts
  const min = Math.round(diff / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} дн назад`
  return new Date(ts).toLocaleDateString('ru-RU')
}

export function fmtPlaytime(ms: number): string {
  if (!ms || ms < 60000) return '0 мин'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export const headUrl = (name: string, size = 64) =>
  `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`

export function isImageIcon(icon: string | undefined | null): boolean {
  return !!icon && /^https?:\/\//i.test(icon)
}

export function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

let manifestPromise: Promise<VersionManifest> | null = null

export function loadManifest(force = false): Promise<VersionManifest> {
  if (force || !manifestPromise) {
    manifestPromise = api.versions.manifest(force).catch((e) => {
      manifestPromise = null
      throw e
    })
  }
  return manifestPromise
}

export function loaderLabel(loader: string, loaderVersion?: string): string {
  if (loader === 'fabric') return `Fabric${loaderVersion ? ` ${loaderVersion}` : ''}`
  if (loader === 'forge') return `Forge${loaderVersion ? ` ${loaderVersion}` : ''}`
  return 'Vanilla'
}
