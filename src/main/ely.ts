import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Account, SkinInfo } from '../shared/types'
import { ensureDir, exists, fileSize } from './fsutil'
import { downloadFile, fetchJson, USER_AGENT } from './http'
import { p } from './paths'
import type { Progress } from './progress'

const AUTH_URL = 'https://authserver.ely.by'
export const ELY_INJECTOR_URL = 'https://authserver.ely.by/api/authlib-injector'

const PINNED_INJECTOR = '1.2.8'

export interface ElySession {
  name: string
  uuid: string
  accessToken: string
  clientToken: string
  elyId?: number
  email?: string
}

interface ElyProfile {
  id: string
  name: string
}

interface ElyAuthResponse {
  accessToken?: string
  clientToken?: string
  selectedProfile?: ElyProfile
  availableProfiles?: ElyProfile[]
  user?: {
    id?: number
    username?: string
    email?: string
  }
}

function dashUuid(raw: string): string {
  const hex = String(raw ?? '').replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) return hex
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function elyError(status: number, data: Record<string, unknown>): string {
  const raw = String(data.errorMessage ?? data.error ?? '').trim()
  if (/two[ -]?factor|protected with two/i.test(raw)) {
    return 'Включена двухфакторная защита Ely.by — введите код из приложения.'
  }
  if (/invalid credentials|invalid email or password/i.test(raw)) {
    return 'Неверный логин или пароль Ely.by.'
  }
  if (/token expired|invalid token/i.test(raw)) {
    return 'Сессия Ely.by истекла — войдите заново.'
  }
  if (/invalid request|required/i.test(raw)) {
    return 'Ely.by отклонил запрос: проверьте логин и пароль.'
  }
  if (status === 401 || status === 403) {
    return 'Ely.by отклонил вход. Проверьте логин, пароль и код двухфакторной защиты.'
  }
  return raw || `Ely.by вернул ошибку ${status}`
}

async function elyPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${AUTH_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
  } catch (e) {
    throw new Error(`Не удалось связаться с Ely.by: ${(e as Error).message}`)
  }

  const text = await res.text().catch(() => '')
  let data: Record<string, unknown> = {}
  if (text.trim()) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      /* сервер мог вернуть пустой ответ */
    }
  }
  if (!res.ok) throw new Error(elyError(res.status, data))
  return data as T
}

/** Прямая авторизация Ely.by (логин/почта + пароль, при необходимости TOTP). */
export async function elyAuthenticate(login: string, password: string, totp?: string): Promise<ElySession> {
  const username = login.trim()
  if (!username || !password) throw new Error('Введите логин и пароль Ely.by')
  const clientToken = randomBytes(16).toString('hex')
  const code = totp?.trim()
  const data = await elyPost<ElyAuthResponse>('/auth/authenticate', {
    username,
    password: code ? `${password}:${code}` : password,
    clientToken,
    requestUser: true,
  })
  const profile = data.selectedProfile ?? data.availableProfiles?.[0]
  if (!profile || !data.accessToken) throw new Error('Ely.by не вернул игровой профиль аккаунта')
  return {
    name: profile.name,
    uuid: dashUuid(profile.id),
    accessToken: data.accessToken,
    clientToken: data.clientToken ?? clientToken,
    elyId: data.user?.id,
    email: data.user?.email,
  }
}

/** Продлевает токен Ely.by. Если сервер недоступен, но токен ещё валиден — оставляем его. */
export async function refreshElyAccount(account: Account): Promise<Account> {
  if (!account.accessToken || !account.clientToken) {
    throw new Error('Сессия Ely.by потеряна — войдите в аккаунт заново.')
  }
  try {
    const data = await elyPost<ElyAuthResponse>('/auth/refresh', {
      accessToken: account.accessToken,
      clientToken: account.clientToken,
      requestUser: true,
    })
    const profile = data.selectedProfile
    return {
      ...account,
      name: profile?.name || account.name,
      uuid: profile?.id ? dashUuid(profile.id) : account.uuid,
      accessToken: data.accessToken || account.accessToken,
      clientToken: data.clientToken || account.clientToken,
      lastLogin: Date.now(),
    }
  } catch (e) {
    try {
      await elyPost<Record<string, never>>('/auth/validate', { accessToken: account.accessToken })
      return { ...account, lastLogin: Date.now() }
    } catch {
      throw new Error(`Сессия Ely.by истекла — войдите в аккаунт заново. ${(e as Error).message}`)
    }
  }
}

/** Скачивает authlib-injector, чтобы игра использовала сессии Ely.by, а не Mojang. */
export async function ensureAuthlibInjector(progress: Progress): Promise<string> {
  const dir = path.join(p.cache(), 'authlib-injector')
  const dest = path.join(dir, 'authlib-injector.jar')
  if ((await fileSize(dest)) > 100_000) return dest

  await ensureDir(dir)
  progress.phase('ely', 1)
  progress.note('Загрузка authlib-injector для Ely.by')

  let url = `https://github.com/yushijinhun/authlib-injector/releases/download/v${PINNED_INJECTOR}/authlib-injector-${PINNED_INJECTOR}.jar`
  try {
    const release = await fetchJson<{ assets?: { name: string; browser_download_url: string }[] }>(
      'https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest',
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' }, retries: 1 },
    )
    const asset = release.assets?.find((a) => /^authlib-injector-.*\.jar$/i.test(a.name))
    if (asset) url = asset.browser_download_url
  } catch {
    /* используем закреплённую версию */
  }

  await downloadFile(url, dest)
  if (!(await exists(dest))) throw new Error('Не удалось скачать authlib-injector')
  return dest
}

export async function removeElyCache(): Promise<void> {
  await fs.promises.rm(path.join(p.cache(), 'authlib-injector'), { recursive: true, force: true }).catch(() => {})
}

/**
 * Текущий скин Ely.by: ссылка на текстуру и модель.
 * Официальный API скинов доступен только для чтения — смена скина выполняется на сайте Ely.by.
 */
export async function elySkin(name: string): Promise<SkinInfo> {
  const nickname = String(name ?? '').trim()
  if (!/^[A-Za-z0-9_]{1,16}$/.test(nickname)) throw new Error('Некорректный ник для скина')

  const res = await fetch(`https://skinsystem.ely.by/textures/${encodeURIComponent(nickname)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 204) return { name: nickname, url: null, model: null }
  if (!res.ok) throw new Error(`Сервис скинов Ely.by ответил ${res.status}`)

  const data = (await res.json()) as {
    SKIN?: { url?: string; metadata?: { model?: string } }
  }
  const url = data.SKIN?.url ?? null
  return {
    name: nickname,
    url,
    model: url ? (data.SKIN?.metadata?.model === 'slim' ? 'slim' : 'classic') : null,
  }
}
