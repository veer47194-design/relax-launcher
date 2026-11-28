import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateInfo, UpdateProgress } from '../shared/types'
import { ensureDir, fileSize } from './fsutil'
import { fetchJson, USER_AGENT } from './http'
import { broadcast } from './progress'

const REPO = 'veer47194-design/relax-launcher'
const CHECK_TTL = 6 * 60 * 60 * 1000
/** Если обновления нет, перепроверяем чаще: новый релиз должен появиться быстро. */
const NO_UPDATE_TTL = 30 * 60 * 1000
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`

interface CacheFile {
  at: number
  info: UpdateInfo
}

let memoryCache: CacheFile | null = null
let pending: UpdateInfo | null = null
let downloaded: { path: string; version: string } | null = null
let downloading = false

function cachePath(): string {
  return path.join(app.getPath('userData'), 'update-cache.json')
}

function readCache(): CacheFile | null {
  if (memoryCache) return memoryCache
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CacheFile
    if (raw && raw.info && typeof raw.at === 'number') {
      memoryCache = raw
      return raw
    }
  } catch {
    /* кеша нет — не страшно */
  }
  return null
}

function writeCache(info: UpdateInfo): void {
  memoryCache = { at: Date.now(), info }
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
    fs.writeFileSync(cachePath(), JSON.stringify(memoryCache), 'utf8')
  } catch {
    /* кеш не критичен */
  }
}

/** Кеш «обновлений нет» живёт меньше, а смена версии лаунчера сбрасывает его сразу. */
function cacheIsFresh(cached: CacheFile, current: string): boolean {
  if (cached.info.current !== current) return false
  const ttl = cached.info.available ? CHECK_TTL : NO_UPDATE_TTL
  return Date.now() - cached.at < ttl
}

function parts(version: string): number[] {
  return String(version)
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10))
    .map((x) => (Number.isFinite(x) ? x : 0))
}

/** Сравнивает версии по числовым сегментам: 0.1.10 > 0.1.9. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a)
  const right = parts(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  prerelease?: boolean
  draft?: boolean
  assets?: { name: string; browser_download_url: string; size: number }[]
}

function assetOf(release: GitHubRelease): { name: string; url: string; size: number } | null {
  const assets = release.assets ?? []
  const setup = assets.find((a) => /^Relax-Launcher-Setup-.*\.exe$/i.test(a.name))
  const anyExe = assets.find((a) => /\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name))
  const picked = setup ?? anyExe
  if (!picked) return null
  return { name: picked.name, url: picked.browser_download_url, size: picked.size }
}

/**
 * Резервный путь, когда GitHub API отдаёт 403 из-за лимита запросов.
 * Страница /releases/latest не лимитируется так же жёстко: профайлим редирект
 * и достаём версию из адреса, а ссылку на установщик собираем сами.
 */
async function fromLatestPage(current: string): Promise<UpdateInfo | null> {
  const page = `https://github.com/${REPO}/releases/latest`
  const res = await fetch(page, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  const location = res.headers.get('location') ?? ''
  let version = ''
  const fromRedirect = /\/tag\/v?([^/?#]+)/i.exec(location)
  if (fromRedirect) version = decodeURIComponent(fromRedirect[1])
  if (!version && res.ok) {
    const html = (await res.text()).slice(0, 300000)
    const fromHtml = /\/tag\/v?(\d[\w.-]*)/i.exec(html)
    if (fromHtml) version = fromHtml[1]
  }
  version = String(version).replace(/^v/i, '')
  if (!/^\d[\w.-]*$/.test(version)) return null
  const assetName = `Relax-Launcher-Setup-${version}.exe`
  return {
    available: compareVersions(version, current) > 0,
    current,
    version,
    notes: '',
    pageUrl: location ? new URL(location, page).toString() : page,
    assetName,
    assetUrl: `https://github.com/${REPO}/releases/download/v${version}/${assetName}`,
  }
}

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const current = app.getVersion()
  const cached = readCache()
  if (!force && cached && cacheIsFresh(cached, current)) return cached.info

  try {
    const release = await fetchJson<GitHubRelease>(RELEASE_API, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      timeoutMs: 15000,
      retries: 1,
    })
    const version = String(release.tag_name ?? release.name ?? '').replace(/^v/i, '')
    if (!version) throw new Error('GitHub не вернул версию релиза')
    const asset = assetOf(release)
    const info: UpdateInfo = {
      available: !release.prerelease && !release.draft && compareVersions(version, current) > 0,
      current,
      version,
      notes: release.body?.slice(0, 4000) ?? '',
      pageUrl: release.html_url ?? `https://github.com/${REPO}/releases`,
      assetName: asset?.name,
      assetUrl: asset?.url,
      size: asset?.size,
      publishedAt: release.published_at,
    }
    pending = info.available ? info : null
    writeCache(info)
    return info
  } catch (e) {
    const message = (e as Error).message
    if (/rate limit|403|forbidden/i.test(message)) {
      try {
        const fallback = await fromLatestPage(current)
        if (fallback) {
          pending = fallback.available ? fallback : null
          writeCache(fallback)
          return fallback
        }
      } catch {
        /* запасной путь не сработал — покажем понятную ошибку ниже */
      }
    }
    return {
      available: false,
      current,
      error: /rate limit|403/i.test(message)
        ? 'GitHub временно ограничил проверку обновлений'
        : message,
    }
  }
}

export async function downloadUpdate(): Promise<{ path: string }> {
  if (downloading) throw new Error('Обновление уже скачивается')
  const info = pending ?? (await checkForUpdate(true))
  if (!info.available || !info.assetUrl || !info.assetName) {
    throw new Error('Обновление не найдено')
  }
  if (downloaded && downloaded.version === info.version) {
    const size = await fileSize(downloaded.path)
    if (size > 0) return { path: downloaded.path }
  }

  const dir = path.join(app.getPath('temp'), 'relax-launcher-update')
  await ensureDir(dir)
  const dest = path.join(dir, info.assetName)
  const tmp = `${dest}.part`
  const version = info.version ?? '0.0.0'

  downloading = true
  const report = (progress: UpdateProgress) => broadcast('update:progress', progress)
  try {
    report({ phase: 'download', received: 0, total: info.size ?? 0, percent: 0, version })
    const res = await fetch(info.assetUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
      signal: AbortSignal.timeout(30 * 60 * 1000),
    })
    if (!res.ok || !res.body) throw new Error(`GitHub ответил ${res.status} ${res.statusText}`)

    const total = Number(res.headers.get('content-length')) || info.size || 0
    let received = 0
    let lastEmit = 0
    const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    stream.on('data', (chunk: Buffer) => {
      received += chunk.length
      const now = Date.now()
      if (now - lastEmit < 120 && received !== total) return
      lastEmit = now
      report({
        phase: 'download',
        received,
        total,
        percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
        version,
      })
    })
    await pipeline(stream, fs.createWriteStream(tmp))
    if (total > 0 && received !== total) {
      throw new Error(`Файл скачался не полностью: ${received} из ${total} байт`)
    }
    await fs.promises.rm(dest, { force: true }).catch(() => {})
    await fs.promises.rename(tmp, dest)
    downloaded = { path: dest, version }
    report({ phase: 'ready', received, total, percent: 100, version, path: dest })
    return { path: dest }
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
    report({
      phase: 'error',
      received: 0,
      total: info.size ?? 0,
      percent: 0,
      version,
      error: (e as Error).message,
    })
    throw e
  } finally {
    downloading = false
  }
}

/** Запускает скачанный установщик и закрывает лаунчер, чтобы тот заменил файлы. */
export async function installUpdate(): Promise<void> {
  if (!downloaded) throw new Error('Сначала скачайте обновление')
  const size = await fileSize(downloaded.path)
  if (!size || size <= 0) {
    downloaded = null
    throw new Error('Файл обновления пропал — скачайте заново')
  }
  const child = spawn(downloaded.path, [], { detached: true, stdio: 'ignore', windowsHide: false })
  // Не закрываем лаунчер, если установщик не запустился: пользователь останется
  // с работающим окном и сможет повторить установку.
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      child.off('spawn', onSpawn)
      child.off('error', onError)
    }
    const onSpawn = () => {
      cleanup()
      resolve()
    }
    const onError = (e: Error) => {
      cleanup()
      reject(new Error(`Не удалось запустить установщик: ${e.message}`))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Установщик не запустился — попробуйте ещё раз'))
    }, 10000)
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
  child.unref()
  setTimeout(() => app.quit(), 1200)
}

export function openReleasePage(): Promise<void> {
  const url = pending?.pageUrl ?? `https://github.com/${REPO}/releases`
  return shell.openExternal(url)
}

/** Проверка в фоне при старте: рендерер сам покажет баннер, если обновление есть. */
export function startBackgroundCheck(): void {
  void checkForUpdate(false).catch(() => {})
}
