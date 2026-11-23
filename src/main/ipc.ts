import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ContentKind,
  CreateInstanceInput,
  Instance,
  InstanceExportOptions,
  Loader,
  SearchParams,
  Settings,
} from '../shared/types'
import { clearBackgroundFile, importBackground } from './background'
import { getCacheInfo, clearCache } from './cache'
import { config, ensureInstanceDirs } from './config'
import { analyzeCrash } from './crash'
import { dirSize } from './dirsize'
import { beginDownload, DownloadAbortedError, endDownload, getDownload } from './downloads'
import {
  clearDownloadHistory,
  listDownloads,
  onDownloadsChange,
  setDownloadPaused,
} from './downloadLog'
import { elyAuthenticate, elySkin } from './ely'
import { fabricLoaders, latestStableLoader } from './fabric'
import { forgeLoaders, latestForgeLoader } from './forge'
import { exportInstance } from './instanceExport'
import { detectSystemJava, listRuntimes, systemInfo } from './java'
import { launcher } from './launch'
import { findManifestVersion, getManifest, installVersion, installedVersions, removeVersion } from './mojang'
import { installModpack, installModpackFile } from './modpack'
import { getProject, getVersions, searchProjects } from './modrinth'
import { installMod, listMods, optimizeApply, optimizePlan, removeMod, toggleMod } from './mods'
import { p } from './paths'
import { Progress, broadcast } from './progress'
import { listScreenshots, removeScreenshot, resolveScreenshot } from './screenshots'

const SETTINGS_KEYS: (keyof Settings)[] = [
  'rootDir',
  'javaPath',
  'autoJava',
  'memoryMb',
  'minMemoryMb',
  'gcPreset',
  'customJvmArgs',
  'closeLauncherOnStart',
  'showConsole',
  'downloadConcurrency',
  'resolution',
  'activeAccountId',
  'activeInstanceId',
  'onboardingDone',
  'theme',
  'accentColor',
  'background',
  'backgroundImage',
  'wallpaperOpacity',
  'uiDensity',
  'fontSize',
  'fontFamily',
  'reduceMotion',
]

function settingsPatch(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {}
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      ;(out as Record<string, unknown>)[key] = patch[key]
    }
  }
  return out
}

function pushState() {
  broadcast('state', config().state())
}

function openTarget(kind: 'root' | 'instance' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'crashes' | 'logs' | 'screenshots' | 'saves', instanceId?: string): string {
  const cfg = config()
  let target: string
  if (kind === 'root') target = p.root()
  else if (kind === 'logs') target = p.logs()
  else if (kind === 'crashes') {
    if (!instanceId) throw new Error('Не указана сборка')
    cfg.getInstance(instanceId)
    target = path.join(p.instance(instanceId), 'crash-reports')
  } else {
    if (!instanceId) throw new Error('Не указана сборка')
    cfg.getInstance(instanceId)
    if (kind === 'mods') target = p.instanceMods(instanceId)
    else target = path.join(p.instance(instanceId), kind)
  }
  fs.mkdirSync(target, { recursive: true })
  return target
}

export function registerIpc() {
  onDownloadsChange((records) => broadcast('downloads:list', records))

  ipcMain.handle('state:get', () => config().state())

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const state = config().updateSettings(settingsPatch(patch))
    broadcast('state', state)
    return state
  })

  ipcMain.handle('settings:set-background', async (_e, filePath: string | null) => {
    const previous = config().get().settings.backgroundImage
    if (!filePath) {
      const state = config().updateSettings({ backgroundImage: null })
      await clearBackgroundFile(previous)
      broadcast('state', state)
      return state
    }
    const name = await importBackground(String(filePath))
    const state = config().updateSettings({ backgroundImage: name })
    if (previous && previous !== name) await clearBackgroundFile(previous)
    broadcast('state', state)
    return state
  })

  ipcMain.handle('accounts:add', (_e, name: string) => {
    const state = config().addAccount(String(name ?? ''))
    broadcast('state', state)
    return state
  })
  ipcMain.handle('accounts:ely-login', async (_e, login: string, password: string, totp?: string) => {
    const session = await elyAuthenticate(String(login ?? ''), String(password ?? ''), totp ? String(totp) : undefined)
    const state = config().addElyAccount(session)
    broadcast('state', state)
    return state
  })
  ipcMain.handle('accounts:remove', (_e, id: string) => {
    const state = config().removeAccount(String(id))
    broadcast('state', state)
    return state
  })
  ipcMain.handle('accounts:select', (_e, id: string) => {
    const state = config().selectAccount(String(id))
    broadcast('state', state)
    return state
  })
  ipcMain.handle('accounts:skin', async (_e, name: string) => elySkin(String(name ?? '')))

  ipcMain.handle('versions:manifest', async (_e, refresh?: boolean) => getManifest(!!refresh))
  ipcMain.handle('versions:installed', async () => installedVersions())
  ipcMain.handle('versions:fabric-loaders', async (_e, mcVersion: string) => fabricLoaders(String(mcVersion)))
  ipcMain.handle('versions:forge-loaders', async (_e, mcVersion: string) => forgeLoaders(String(mcVersion)))
  ipcMain.handle('versions:install', async (_e, versionId: string) => {
    const id = String(versionId)
    await findManifestVersion(id)
    const taskId = `install:${id}`
    const controller = beginDownload(taskId)
    const progress = new Progress(taskId, `Установка Minecraft ${id}`)
    try {
      await installVersion(id, progress, controller)
      progress.done('Версия установлена')
      return { cancelled: false }
    } catch (e) {
      if (e instanceof DownloadAbortedError || controller.aborted) {
        progress.done('Скачивание остановлено')
        return { cancelled: true }
      }
      progress.fail((e as Error).message)
      throw e
    } finally {
      endDownload(taskId)
    }
  })
  ipcMain.handle('versions:remove', async (_e, versionId: string) => {
    await removeVersion(String(versionId))
  })

  ipcMain.handle('download:pause', (_e, taskId: string, paused: boolean) => {
    const controller = getDownload(String(taskId))
    if (!controller) return false
    if (paused) controller.pause()
    else controller.resume()
    setDownloadPaused(String(taskId), controller.isPaused)
    broadcast('download:state', { id: String(taskId), paused: controller.isPaused })
    return true
  })
  ipcMain.handle('download:cancel', (_e, taskId: string) => {
    const controller = getDownload(String(taskId))
    if (!controller) return false
    controller.cancel()
    broadcast('download:state', { id: String(taskId), paused: false })
    return true
  })

  ipcMain.handle('downloads:list', async () => listDownloads())
  ipcMain.handle('downloads:clear-history', () => {
    clearDownloadHistory()
  })
  ipcMain.handle('downloads:cache-info', async () => getCacheInfo())
  ipcMain.handle('downloads:clear-cache', async () => clearCache())

  ipcMain.handle('instances:create', async (_e, input: CreateInstanceInput) => {
    if (!input || typeof input !== 'object') throw new Error('Некорректные данные сборки')
    const mcVersion = String(input.mcVersion)
    await findManifestVersion(mcVersion)
    let loader: Loader = input.loader === 'fabric' ? 'fabric' : input.loader === 'forge' ? 'forge' : 'vanilla'
    let loaderVersion = input.loaderVersion
    if (loader === 'fabric') {
      const available = await fabricLoaders(mcVersion)
      if (available.length === 0) throw new Error(`Fabric пока не поддерживает Minecraft ${mcVersion}`)
      if (!loaderVersion) loaderVersion = await latestStableLoader(mcVersion)
      if (!available.some((l) => l.version === loaderVersion)) throw new Error('Выбранная версия Fabric недоступна')
    } else if (loader === 'forge') {
      const available = await forgeLoaders(mcVersion)
      if (available.length === 0) throw new Error(`Forge пока не поддерживает Minecraft ${mcVersion}`)
      if (!loaderVersion) loaderVersion = await latestForgeLoader(mcVersion)
      if (!available.some((l) => l.version === loaderVersion)) {
        throw new Error('Выбранная версия Forge недоступна')
      }
    } else {
      loaderVersion = undefined
    }
    const instance = config().createInstance({
      name: String(input.name || `${mcVersion}`).slice(0, 60),
      mcVersion,
      loader,
      loaderVersion,
      memoryMb: input.memoryMb,
      icon: input.icon,
    })
    await ensureInstanceDirs(instance.id)
    pushState()
    return instance
  })

  ipcMain.handle('instances:update', (_e, id: string, patch: Partial<Instance>) => {
    const clean: Partial<Instance> = { ...patch }
    delete clean.id
    delete clean.created
    delete clean.playtimeMs
    const state = config().updateInstance(String(id), clean)
    broadcast('state', state)
    return state
  })

  ipcMain.handle('instances:remove', async (_e, id: string) => {
    const instanceId = String(id)
    config().getInstance(instanceId)
    if (launcher.isRunning(instanceId)) throw new Error('Сначала остановите игру')
    const state = config().removeInstance(instanceId)
    await fs.promises.rm(p.instance(instanceId), { recursive: true, force: true }).catch(() => {})
    broadcast('state', state)
    return state
  })

  ipcMain.handle('instances:duplicate', async (_e, id: string) => {
    const source = config().getInstance(String(id))
    const copy = config().createInstance({
      name: `${source.name} (копия)`,
      mcVersion: source.mcVersion,
      loader: source.loader,
      loaderVersion: source.loaderVersion,
      memoryMb: source.memoryMb,
      icon: source.icon,
      modpack: source.modpack,
    })
    if (source.resolution) config().updateInstance(copy.id, { resolution: source.resolution })
    if (source.gcPreset) config().updateInstance(copy.id, { gcPreset: source.gcPreset })
    try {
      await fs.promises.cp(p.instance(source.id), p.instance(copy.id), { recursive: true })
    } catch {
      await ensureInstanceDirs(copy.id)
    }
    const state = config().state()
    broadcast('state', state)
    return state
  })

  ipcMain.handle('instances:select', (_e, id: string) => {
    const state = config().selectInstance(String(id))
    broadcast('state', state)
    return state
  })

  ipcMain.handle('instances:size', async (_e, id: string) => dirSize(p.instance(String(id))))

  ipcMain.handle('instances:export', async (_e, id: string, options?: InstanceExportOptions) => {
    const instance = config().getInstance(String(id))
    const safeName =
      instance.name
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || instance.id

    const picked = await dialog.showSaveDialog({
      title: 'Экспорт сборки',
      defaultPath: path.join(app.getPath('documents'), `${safeName}.zip`),
      filters: [{ name: 'ZIP-архив', extensions: ['zip'] }],
    })
    if (picked.canceled || !picked.filePath) return { cancelled: true }

    const taskId = `export:${instance.id}`
    const progress = new Progress(taskId, `Экспорт: ${instance.name}`)
    try {
      const result = await exportInstance(
        instance,
        picked.filePath,
        { includeSaves: !!options?.includeSaves },
        progress,
      )
      progress.done(`${result.files} файлов · ${(result.bytes / 1024 / 1024).toFixed(1)} МБ`)
      return {
        cancelled: false,
        file: result.file,
        files: result.files,
        bytes: result.bytes,
      }
    } catch (e) {
      progress.fail((e as Error).message)
      throw e
    }
  })

  ipcMain.handle('screenshots:list', async (_e, instanceId: string) => listScreenshots(String(instanceId)))
  ipcMain.handle('screenshots:remove', async (_e, instanceId: string, file: string) =>
    removeScreenshot(String(instanceId), String(file)),
  )
  ipcMain.handle('screenshots:open', async (_e, instanceId: string, file: string) => {
    const full = resolveScreenshot(String(instanceId), String(file))
    const error = await shell.openPath(full)
    if (error) throw new Error(error)
  })

  ipcMain.handle('launch:start', async (_e, instanceId: string) => {
    const result = await launcher.start(String(instanceId))
    pushState()
    return result
  })
  ipcMain.handle('launch:stop', (_e, instanceId: string) => {
    launcher.stop(String(instanceId))
  })
  ipcMain.handle('launch:running', async () => launcher.runningIds())

  ipcMain.handle('modrinth:search', async (_e, params: SearchParams) => {
    if (!params || typeof params !== 'object') throw new Error('Некорректный запрос')
    return searchProjects(params)
  })
  ipcMain.handle('modrinth:project', async (_e, id: string) => getProject(String(id)))
  ipcMain.handle('modrinth:versions', async (_e, projectId: string, gameVersion?: string, loader?: Loader) =>
    getVersions(String(projectId), gameVersion ? String(gameVersion) : undefined, loader),
  )

  ipcMain.handle('mods:list', async (_e, instanceId: string, kind?: ContentKind) => listMods(String(instanceId), kind))
  ipcMain.handle('mods:install', async (_e, instanceId: string, projectId: string, kind?: ContentKind) =>
    installMod(String(instanceId), String(projectId), kind),
  )
  ipcMain.handle('mods:remove', async (_e, instanceId: string, file: string, kind?: ContentKind) =>
    removeMod(String(instanceId), String(file), kind),
  )
  ipcMain.handle(
    'mods:toggle',
    async (_e, instanceId: string, file: string, enabled: boolean, kind?: ContentKind) =>
      toggleMod(String(instanceId), String(file), !!enabled, kind),
  )
  ipcMain.handle('mods:optimize-plan', async (_e, instanceId: string) => optimizePlan(String(instanceId)))
  ipcMain.handle('mods:optimize-apply', async (_e, instanceId: string, slugs: string[]) =>
    optimizeApply(String(instanceId), Array.isArray(slugs) ? slugs.map(String) : []),
  )

  ipcMain.handle('modpacks:install', async (_e, projectId: string) => {
    const result = await installModpack(String(projectId))
    pushState()
    return result
  })

  ipcMain.handle('modpacks:install-file', async (_e, filePath: string) => {
    const result = await installModpackFile(String(filePath))
    pushState()
    return result
  })

  ipcMain.handle('java:detect', async () => detectSystemJava())
  ipcMain.handle('java:runtimes', async () => listRuntimes())

  ipcMain.handle('logs:history', async (_e, instanceId: string) => launcher.history(String(instanceId)))

  ipcMain.handle('diagnostics:crash', async (_e, instanceId: string) => {
    const id = String(instanceId)
    const logs = launcher.history(id).map((line) => line.line)
    return analyzeCrash(id, logs, 0, Date.now())
  })

  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    root: p.root(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
  }))

  ipcMain.handle('app:system', async () => systemInfo())

  ipcMain.handle('app:open-path', async (_e, kind: 'root' | 'instance' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'crashes' | 'logs' | 'screenshots' | 'saves', instanceId?: string) => {
    const target = openTarget(kind, instanceId)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return target
  })

  ipcMain.handle('app:open-external', async (_e, url: string) => {
    const parsed = new URL(String(url))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Недопустимая ссылка')
    await shell.openExternal(parsed.toString())
  })

  ipcMain.handle('app:pick-directory', async (_e, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath: defaultPath || p.root(),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(
    'app:pick-file',
    async (_e, filters?: { name: string; extensions: string[] }[]) => {
      const result = await dialog.showOpenDialog({
        defaultPath: p.root(),
        properties: ['openFile'],
        filters: filters ?? [{ name: 'Исполняемые файлы', extensions: ['exe'] }],
      })
      return result.canceled ? null : result.filePaths[0]
    },
  )

  ipcMain.handle('app:clipboard', async (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })

  ipcMain.on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('win:toggle-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
}
