import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Account, AppState, Instance, Settings } from '../shared/types'
import { ensureDir } from './fsutil'
import { configDir, setRoot } from './paths'

export interface ConfigData {
  settings: Settings
  accounts: Account[]
  instances: Instance[]
}

function defaultMemory(): number {
  const totalMb = Math.round(os.totalmem() / 1024 / 1024)
  if (totalMb >= 16384) return 6144
  if (totalMb >= 8192) return 4096
  if (totalMb >= 6144) return 3072
  return 2048
}

export function defaultSettings(): Settings {
  return {
    rootDir: path.join(configDir(), 'data'),
    javaPath: null,
    autoJava: true,
    memoryMb: defaultMemory(),
    minMemoryMb: 512,
    gcPreset: 'balanced',
    customJvmArgs: '',
    closeLauncherOnStart: false,
    showConsole: true,
    downloadConcurrency: 24,
    resolution: { width: 1280, height: 720, fullscreen: false },
    activeAccountId: null,
    activeInstanceId: null,
    onboardingDone: false,
    theme: 'relax',
    accentColor: null,
    background: 'aurora',
    backgroundImage: null,
    wallpaperOpacity: 0.36,
    uiDensity: 'comfortable',
    fontSize: 14,
    fontFamily: 'default',
    reduceMotion: false,
    autoUpdate: true,
  }
}

export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const ICONS = ['🌿', '⚡', '🔥', '💎', '🌙', '🪐', '🍀', '🎮', '🧊', '🌊', '🦊', '🍉']

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return base || 'instance'
}

export function validateNickname(name: string): string {
  const trimmed = name.trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmed)) {
    throw new Error('Никнейм должен содержать 3–16 символов: латиница, цифры и «_»')
  }
  return trimmed
}

export function clampMemory(mb: number): number {
  if (!Number.isFinite(mb)) return 2048
  return Math.max(512, Math.min(65536, Math.round(mb / 256) * 256))
}

class ConfigStore {
  private data: ConfigData
  private timer: NodeJS.Timeout | null = null
  private readonly file: string
  warning: string | null = null

  constructor() {
    this.file = path.join(configDir(), 'config.json')
    this.data = this.load()
    this.applyRoot()
  }

  private load(): ConfigData {
    const defaults: ConfigData = { settings: defaultSettings(), accounts: [], instances: [] }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ConfigData>
      const settings = { ...defaults.settings, ...(raw.settings ?? {}) }
      settings.resolution = { ...defaults.settings.resolution, ...(raw.settings?.resolution ?? {}) }
      settings.memoryMb = clampMemory(settings.memoryMb)
      const minMb = Math.round(Number(settings.minMemoryMb))
      settings.minMemoryMb = Number.isFinite(minMb)
        ? Math.max(256, Math.min(settings.memoryMb, minMb))
        : Math.min(512, settings.memoryMb)
      return {
        settings,
        accounts: Array.isArray(raw.accounts)
          ? raw.accounts.map((a) => ({ ...a, type: a.type === 'ely' ? 'ely' : 'offline' }))
          : [],
        instances: Array.isArray(raw.instances) ? raw.instances.map((i) => ({ ...i, playtimeMs: i.playtimeMs ?? 0 })) : [],
      }
    } catch (e) {
      // Повреждённый конфиг НЕ перезаписываем сразу: сначала сохраняем копию.
      const backup = `${this.file}.bad-${new Date().toISOString().replace(/[:.]/g, '-')}`
      try {
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, backup)
      } catch {
        /* копию сохранить не удалось — продолжаем с дефолтами */
      }
      this.warning = `Конфиг повреждён и сброшен. Резервная копия: ${backup}`
      console.error('[config] не удалось прочитать конфиг', e)
      return defaults
    }
  }

  private applyRoot() {
    const fallback = defaultSettings().rootDir
    const target = this.data.settings.rootDir
    try {
      setRoot(target)
      fs.mkdirSync(target, { recursive: true })
    } catch (e) {
      this.data.settings.rootDir = fallback
      setRoot(fallback)
      try {
        fs.mkdirSync(fallback, { recursive: true })
      } catch {
        /* крайний случай — даже дефолтная папка недоступна */
      }
      this.warning = `Папка данных «${target}» недоступна — используется «${fallback}»`
      console.error('[config] не удалось создать папку данных', e)
    }
  }

  get(): ConfigData {
    return this.data
  }

  state(): AppState {
    return {
      settings: this.data.settings,
      accounts: this.data.accounts,
      instances: this.data.instances,
      warning: this.warning,
    }
  }

  saveNow() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error('[config] не удалось сохранить', e)
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.saveNow()
    }, 150)
  }

  updateSettings(patch: Partial<Settings>): AppState {
    const next = { ...this.data.settings, ...patch }
    if (patch.resolution) next.resolution = { ...this.data.settings.resolution, ...patch.resolution }
    next.memoryMb = clampMemory(next.memoryMb)
    const minMb = Math.round(Number(next.minMemoryMb))
    next.minMemoryMb = Number.isFinite(minMb) ? Math.max(256, Math.min(next.memoryMb, minMb)) : Math.min(512, next.memoryMb)
    next.downloadConcurrency = Math.max(1, Math.min(64, Math.round(next.downloadConcurrency)))
    if (!next.rootDir || typeof next.rootDir !== 'string') next.rootDir = defaultSettings().rootDir
    if (next.accentColor && !/^#[0-9a-f]{6}$/i.test(next.accentColor)) next.accentColor = null
    if (
      ![
        'relax',
        'midnight',
        'emerald',
        'sunset',
        'ocean',
        'rose',
        'graphite',
        'lavender',
        'mint',
        'amber',
        'crimson',
        'sky',
      ].includes(next.theme)
    ) {
      next.theme = 'relax'
    }
    if (!['aurora', 'mesh', 'grid', 'waves', 'stars', 'plain'].includes(next.background)) next.background = 'aurora'
    if (next.backgroundImage && !/^[a-z0-9._-]+$/i.test(next.backgroundImage)) next.backgroundImage = null
    const opacity = Number(next.wallpaperOpacity)
    next.wallpaperOpacity = Number.isFinite(opacity) ? Math.max(0.08, Math.min(0.85, opacity)) : 0.36
    if (!['comfortable', 'compact'].includes(next.uiDensity)) next.uiDensity = 'comfortable'
    const fontSize = Number(next.fontSize)
    next.fontSize = Number.isFinite(fontSize) ? Math.max(12, Math.min(18, fontSize)) : 14
    if (!['default', 'segoe', 'mono', 'serif'].includes(next.fontFamily)) next.fontFamily = 'default'
    next.reduceMotion = !!next.reduceMotion
    next.autoUpdate = next.autoUpdate !== false
    const rootChanged = next.rootDir !== this.data.settings.rootDir
    this.data.settings = next
    if (rootChanged) this.applyRoot()
    this.schedule()
    return this.state()
  }

  addAccount(name: string): AppState {
    const nickname = validateNickname(name)
    if (this.data.accounts.some((a) => a.name.toLowerCase() === nickname.toLowerCase())) {
      throw new Error('Аккаунт с таким ником уже существует')
    }
    const account: Account = {
      id: randomBytes(6).toString('hex'),
      name: nickname,
      uuid: offlineUuid(nickname),
      type: 'offline',
      createdAt: Date.now(),
    }
    this.data.accounts.push(account)
    if (!this.data.settings.activeAccountId) this.data.settings.activeAccountId = account.id
    this.schedule()
    return this.state()
  }

  addElyAccount(input: {
    name: string
    uuid: string
    accessToken: string
    clientToken: string
    elyId?: number
    email?: string
    skinModel?: string
  }): AppState {
    const name = String(input.name ?? '').trim()
    const uuid = String(input.uuid ?? '').trim()
    if (!name || !uuid || !input.accessToken) throw new Error('Ely.by вернул неполные данные аккаунта')
    const existing = this.data.accounts.find((a) => a.type === 'ely' && a.uuid === uuid)
    if (existing) {
      Object.assign(existing, {
        name,
        accessToken: input.accessToken,
        clientToken: input.clientToken,
        elyId: input.elyId,
        email: input.email,
        skinModel: input.skinModel,
        lastLogin: Date.now(),
      })
      this.data.settings.activeAccountId = existing.id
      this.schedule()
      return this.state()
    }
    const account: Account = {
      id: randomBytes(6).toString('hex'),
      name,
      uuid,
      type: 'ely',
      createdAt: Date.now(),
      accessToken: input.accessToken,
      clientToken: input.clientToken,
      elyId: input.elyId,
      email: input.email,
      skinModel: input.skinModel,
      lastLogin: Date.now(),
    }
    this.data.accounts.push(account)
    this.data.settings.activeAccountId = account.id
    this.schedule()
    return this.state()
  }

  updateAccount(id: string, patch: Partial<Account>): AppState {
    const account = this.data.accounts.find((a) => a.id === id)
    if (!account) throw new Error('Аккаунт не найден')
    Object.assign(account, patch, { id: account.id, type: account.type, createdAt: account.createdAt })
    this.schedule()
    return this.state()
  }

  removeAccount(id: string): AppState {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
    if (this.data.settings.activeAccountId === id) {
      this.data.settings.activeAccountId = this.data.accounts[0]?.id ?? null
    }
    this.schedule()
    return this.state()
  }

  selectAccount(id: string): AppState {
    if (!this.data.accounts.some((a) => a.id === id)) throw new Error('Аккаунт не найден')
    this.data.settings.activeAccountId = id
    this.schedule()
    return this.state()
  }

  activeAccount(): Account | null {
    return this.data.accounts.find((a) => a.id === this.data.settings.activeAccountId) ?? null
  }

  createInstance(input: {
    name: string
    mcVersion: string
    loader: Instance['loader']
    loaderVersion?: string
    memoryMb?: number
    icon?: string
    modpack?: Instance['modpack']
  }): Instance {
    const name = input.name.trim() || `${input.mcVersion}`
    let id = slugify(name)
    while (this.data.instances.some((i) => i.id === id)) id = `${slugify(name)}-${randomBytes(2).toString('hex')}`
    const instance: Instance = {
      id,
      name,
      icon: input.icon || ICONS[Math.floor(Math.random() * ICONS.length)],
      mcVersion: input.mcVersion,
      loader: input.loader,
      loaderVersion: input.loaderVersion,
      created: Date.now(),
      playtimeMs: 0,
      memoryMb: input.memoryMb ?? this.data.settings.memoryMb,
      modpack: input.modpack,
    }
    this.data.instances.push(instance)
    if (!this.data.settings.activeInstanceId) this.data.settings.activeInstanceId = instance.id
    this.schedule()
    return instance
  }

  getInstance(id: string): Instance {
    const instance = this.data.instances.find((i) => i.id === id)
    if (!instance) throw new Error('Сборка не найдена')
    return instance
  }

  updateInstance(id: string, patch: Partial<Instance>): AppState {
    const instance = this.getInstance(id)
    if (patch.memoryMb != null) patch.memoryMb = clampMemory(patch.memoryMb)
    Object.assign(instance, patch, { id: instance.id, created: instance.created })
    this.schedule()
    return this.state()
  }

  removeInstance(id: string): AppState {
    this.data.instances = this.data.instances.filter((i) => i.id !== id)
    if (this.data.settings.activeInstanceId === id) {
      this.data.settings.activeInstanceId = this.data.instances[0]?.id ?? null
    }
    this.schedule()
    return this.state()
  }

  selectInstance(id: string): AppState {
    this.getInstance(id)
    this.data.settings.activeInstanceId = id
    this.schedule()
    return this.state()
  }

  markPlayed(id: string, ms: number) {
    const instance = this.data.instances.find((i) => i.id === id)
    if (!instance) return
    instance.lastPlayed = Date.now()
    instance.playtimeMs = (instance.playtimeMs ?? 0) + Math.max(0, ms)
    this.schedule()
  }

  flush() {
    this.saveNow()
  }
}

let store: ConfigStore | null = null

export function initConfig(): ConfigStore {
  if (!store) store = new ConfigStore()
  return store
}

export function config(): ConfigStore {
  if (!store) throw new Error('Конфиг ещё не загружен')
  return store
}

export async function ensureInstanceDirs(instanceId: string) {
  const { p } = await import('./paths')
  await ensureDir(p.instance(instanceId))
  await ensureDir(p.instanceMods(instanceId))
  await ensureDir(path.join(p.instance(instanceId), 'resourcepacks'))
  await ensureDir(path.join(p.instance(instanceId), 'shaderpacks'))
}
