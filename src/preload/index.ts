import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DownloadRecord, ExitEvent, LogEvent, ProgressEvent, RelaxApi, UpdateProgress } from '../shared/types'

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RelaxApi = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    system: () => ipcRenderer.invoke('app:system'),
    pathForFile: (file) => webUtils.getPathForFile(file),
    openPath: (kind, instanceId) => ipcRenderer.invoke('app:open-path', kind, instanceId),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    pickDirectory: () => ipcRenderer.invoke('app:pick-directory'),
    pickFile: (filters) => ipcRenderer.invoke('app:pick-file', filters),
    clipboard: (text) => ipcRenderer.invoke('app:clipboard', text),
  },
  state: {
    get: () => ipcRenderer.invoke('state:get'),
  },
  settings: {
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    setBackground: (filePath) => ipcRenderer.invoke('settings:set-background', filePath),
  },
  accounts: {
    add: (name) => ipcRenderer.invoke('accounts:add', name),
    elyLogin: (login, password, totp) => ipcRenderer.invoke('accounts:ely-login', login, password, totp),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    select: (id) => ipcRenderer.invoke('accounts:select', id),
    skin: (name) => ipcRenderer.invoke('accounts:skin', name),
  },
  versions: {
    manifest: (refresh) => ipcRenderer.invoke('versions:manifest', refresh),
    installed: () => ipcRenderer.invoke('versions:installed'),
    fabricLoaders: (mcVersion) => ipcRenderer.invoke('versions:fabric-loaders', mcVersion),
    forgeLoaders: (mcVersion) => ipcRenderer.invoke('versions:forge-loaders', mcVersion),
    install: (versionId) => ipcRenderer.invoke('versions:install', versionId),
    remove: (versionId) => ipcRenderer.invoke('versions:remove', versionId),
  },
  download: {
    pause: (taskId, paused) => ipcRenderer.invoke('download:pause', taskId, paused),
    cancel: (taskId) => ipcRenderer.invoke('download:cancel', taskId),
  },
  instances: {
    create: (input) => ipcRenderer.invoke('instances:create', input),
    update: (id, patch) => ipcRenderer.invoke('instances:update', id, patch),
    remove: (id) => ipcRenderer.invoke('instances:remove', id),
    duplicate: (id) => ipcRenderer.invoke('instances:duplicate', id),
    select: (id) => ipcRenderer.invoke('instances:select', id),
    size: (id) => ipcRenderer.invoke('instances:size', id),
    export: (id, options) => ipcRenderer.invoke('instances:export', id, options),
  },
  launch: {
    start: (instanceId) => ipcRenderer.invoke('launch:start', instanceId),
    stop: (instanceId) => ipcRenderer.invoke('launch:stop', instanceId),
    running: () => ipcRenderer.invoke('launch:running'),
  },
  modrinth: {
    search: (params) => ipcRenderer.invoke('modrinth:search', params),
    project: (id) => ipcRenderer.invoke('modrinth:project', id),
    versions: (projectId, gameVersion, loader) =>
      ipcRenderer.invoke('modrinth:versions', projectId, gameVersion, loader),
  },
  mods: {
    list: (instanceId, kind) => ipcRenderer.invoke('mods:list', instanceId, kind),
    install: (instanceId, projectId, kind) => ipcRenderer.invoke('mods:install', instanceId, projectId, kind),
    remove: (instanceId, file, kind) => ipcRenderer.invoke('mods:remove', instanceId, file, kind),
    toggle: (instanceId, file, enabled, kind) =>
      ipcRenderer.invoke('mods:toggle', instanceId, file, enabled, kind),
    optimizePlan: (instanceId) => ipcRenderer.invoke('mods:optimize-plan', instanceId),
    optimizeApply: (instanceId, slugs) => ipcRenderer.invoke('mods:optimize-apply', instanceId, slugs),
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    clearHistory: () => ipcRenderer.invoke('downloads:clear-history'),
    cacheInfo: () => ipcRenderer.invoke('downloads:cache-info'),
    clearCache: () => ipcRenderer.invoke('downloads:clear-cache'),
  },
  screenshots: {
    list: (instanceId) => ipcRenderer.invoke('screenshots:list', instanceId),
    remove: (instanceId, file) => ipcRenderer.invoke('screenshots:remove', instanceId, file),
    open: (instanceId, file) => ipcRenderer.invoke('screenshots:open', instanceId, file),
  },
  modpacks: {
    install: (projectId) => ipcRenderer.invoke('modpacks:install', projectId),
    installFile: (filePath) => ipcRenderer.invoke('modpacks:install-file', filePath),
  },
  java: {
    detect: () => ipcRenderer.invoke('java:detect'),
    runtimes: () => ipcRenderer.invoke('java:runtimes'),
  },
  logs: {
    history: (instanceId) => ipcRenderer.invoke('logs:history', instanceId),
  },
  diagnostics: {
    crash: (instanceId) => ipcRenderer.invoke('diagnostics:crash', instanceId),
  },
  update: {
    check: (force) => ipcRenderer.invoke('update:check', force),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    openRelease: () => ipcRenderer.invoke('update:open-release'),
    onProgress: (cb) => on<UpdateProgress>('update:progress', cb),
  },
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    onMaximize: (cb) => on<boolean>('win:maximized', cb),
  },
  on: {
    progress: (cb) => on<ProgressEvent>('progress', cb),
    download: (cb) => on<{ id: string; paused: boolean }>('download:state', cb),
    downloads: (cb) => on<DownloadRecord[]>('downloads:list', cb),
    log: (cb) => on<LogEvent>('launch:log', cb),
    logs: (cb) => on<LogEvent[]>('launch:logs', cb),
    exit: (cb) => on<ExitEvent>('launch:exit', cb),
    state: (cb) => on('state', cb),
  },
}

contextBridge.exposeInMainWorld('relax', api)
