export type Loader = 'vanilla' | 'fabric' | 'forge'
export type ContentKind = 'mod' | 'resourcepack' | 'shader'
export type UiDensity = 'comfortable' | 'compact'
export type FontFamily = 'default' | 'segoe' | 'mono' | 'serif'
export type GcPreset = 'off' | 'balanced' | 'aikar' | 'zgc'
export type ThemeId =
  | 'relax'
  | 'midnight'
  | 'emerald'
  | 'sunset'
  | 'ocean'
  | 'rose'
  | 'graphite'
  | 'lavender'
  | 'mint'
  | 'amber'
  | 'crimson'
  | 'sky'
export type BackgroundStyle = 'aurora' | 'mesh' | 'grid' | 'waves' | 'stars' | 'plain'

export interface Resolution {
  width: number
  height: number
  fullscreen: boolean
}

export interface Settings {
  rootDir: string
  javaPath: string | null
  autoJava: boolean
  memoryMb: number
  minMemoryMb: number
  gcPreset: GcPreset
  customJvmArgs: string
  closeLauncherOnStart: boolean
  showConsole: boolean
  downloadConcurrency: number
  resolution: Resolution
  activeAccountId: string | null
  activeInstanceId: string | null
  onboardingDone: boolean
  theme: ThemeId
  accentColor: string | null
  background: BackgroundStyle
  backgroundImage: string | null
  wallpaperOpacity: number
  uiDensity: UiDensity
  fontSize: number
  fontFamily: FontFamily
  reduceMotion: boolean
  /** Автоматически проверять обновления лаунчера при запуске. */
  autoUpdate: boolean
}

export interface Account {
  id: string
  name: string
  uuid: string
  type: 'offline' | 'ely'
  createdAt: number
  accessToken?: string
  clientToken?: string
  elyId?: number
  email?: string
  skinModel?: string
  lastLogin?: number
}

export interface Instance {
  id: string
  name: string
  icon: string
  mcVersion: string
  loader: Loader
  loaderVersion?: string
  created: number
  lastPlayed?: number
  playtimeMs: number
  memoryMb?: number
  javaPath?: string | null
  gcPreset?: GcPreset
  resolution?: Resolution
  modpack?: {
    projectId: string
    versionId: string
    name: string
    iconUrl?: string
  }
}

export interface AppState {
  settings: Settings
  instances: Instance[]
  accounts: Account[]
  warning?: string | null
}

export interface ManifestVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
  time: string
  releaseTime: string
  sha1: string
  complianceLevel?: number
}

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: ManifestVersion[]
}

/* ---------- Mojang version JSON (subset) ---------- */

export interface DownloadInfo {
  path?: string
  sha1: string
  size: number
  url: string
}

export interface OsRule {
  name?: 'windows' | 'osx' | 'linux'
  arch?: string
  version?: string
}

export interface Rule {
  action: 'allow' | 'deny'
  os?: OsRule
  features?: Record<string, boolean>
}

export interface Library {
  name: string
  url?: string
  rules?: Rule[]
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  downloads?: {
    artifact?: DownloadInfo
    classifiers?: Record<string, DownloadInfo>
  }
  sha1?: string
  size?: number
}

export type ArgValue = string | string[]
export type ArgEntry = string | { rules?: Rule[]; value: ArgValue }

export interface AssetIndexRef {
  id: string
  sha1: string
  size: number
  totalSize: number
  url: string
}

export interface LoggingFile {
  id: string
  sha1: string
  size: number
  url: string
}

export interface VersionJson {
  id: string
  type: string
  mainClass: string
  inheritsFrom?: string
  minecraftArguments?: string
  arguments?: { game?: ArgEntry[]; jvm?: ArgEntry[] }
  libraries: Library[]
  assetIndex?: AssetIndexRef
  assets?: string
  downloads?: { client?: DownloadInfo; server?: DownloadInfo }
  javaVersion?: { component: string; majorVersion: number }
  logging?: {
    client?: { argument: string; file: LoggingFile; type: string }
  }
  releaseTime?: string
  time?: string
}

export interface ResolvedVersion {
  id: string
  type: string
  mainClass: string
  libraries: Library[]
  gameArgs: ArgEntry[]
  jvmArgs: ArgEntry[]
  minecraftArguments?: string
  assetIndexId: string
  assetIndex: AssetIndexRef
  client: DownloadInfo | null
  clientVersionId: string
  javaComponent: string
  javaMajor: number
  logging?: { argument: string; file: LoggingFile }
  inheritedFrom?: string
}

/* ---------- Modrinth ---------- */

export interface MrSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  categories: string[]
  display_categories?: string[]
  client_side: string
  server_side: string
  project_type: string
  downloads: number
  follows: number
  icon_url: string | null
  date_modified: string
  versions: string[]
  author: string
  gallery?: string[]
}

export interface MrSearchResult {
  hits: MrSearchHit[]
  offset: number
  limit: number
  total_hits: number
}

export interface MrFile {
  hashes: { sha1?: string; sha512?: string }
  url: string
  filename: string
  primary: boolean
  size: number
}

export interface MrDependency {
  version_id: string | null
  project_id: string | null
  file_name: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface MrVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: string
  game_versions: string[]
  loaders: string[]
  date_published: string
  downloads: number
  files: MrFile[]
  dependencies: MrDependency[]
}

export interface MrProject {
  id: string
  slug: string
  title: string
  description: string
  body?: string
  categories: string[]
  project_type: string
  downloads: number
  followers: number
  icon_url: string | null
  gallery?: { url: string; title?: string; featured?: boolean }[]
  game_versions?: string[]
  loaders?: string[]
  versions?: string[]
  source_url?: string | null
  issues_url?: string | null
  wiki_url?: string | null
  license?: { id: string; name: string }
}

export interface ModInfo {
  file: string
  name: string
  version: string
  description: string
  enabled: boolean
  size: number
  iconUrl?: string | null
}

export interface ModpackInstallResult {
  instance: Instance
  files: number
}

export interface InstanceExportOptions {
  includeSaves?: boolean
}

export interface InstanceExportResult {
  cancelled: boolean
  file?: string
  files?: number
  bytes?: number
}

export interface ScreenshotInfo {
  file: string
  size: number
  modified: number
  url: string
}

export interface SkinInfo {
  name: string
  url: string | null
  model: 'classic' | 'slim' | null
}

export interface UpdateInfo {
  available: boolean
  current: string
  version?: string
  notes?: string
  pageUrl?: string
  assetName?: string
  assetUrl?: string
  size?: number
  publishedAt?: string
  error?: string
}

export interface UpdateProgress {
  phase: 'download' | 'ready' | 'error'
  received: number
  total: number
  percent: number
  version?: string
  path?: string
  error?: string
}

export interface OptimizeMod {
  slug: string
  title: string
  description: string
  minVersion?: string
  maxVersion?: string
  optional?: boolean
}

/* ---------- Java ---------- */

export interface JavaInfo {
  path: string
  version: string
  major: number
  vendor: string
  arch: string
  source: 'system' | 'mojang' | 'custom'
}

/* ---------- Events ---------- */

export type DownloadStatus = 'active' | 'paused' | 'done' | 'error' | 'cancelled'

export interface DownloadRecord {
  id: string
  title: string
  kind: string
  status: DownloadStatus
  current: number
  total: number
  detail?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

export interface CacheInfo {
  totalBytes: number
  partsBytes: number
  partsFiles: number
  installersBytes: number
  installersFiles: number
  modpacksBytes: number
  modpacksFiles: number
  otherBytes: number
}

export interface ProgressEvent {
  id: string
  title: string
  phase: string
  current: number
  total: number
  detail?: string
  done?: boolean
  error?: string
}

export interface LogEvent {
  instanceId: string
  line: string
  stream: 'stdout' | 'stderr' | 'system'
  at: number
}

export interface ExitEvent {
  instanceId: string
  code: number | null
  durationMs: number
  hints: string[]
  crashedAt?: number
  reason?: string
  suspects?: string[]
  reportFile?: string
}

export interface CrashAnalysis {
  crashedAt?: number
  reason?: string
  suspects: string[]
  hints: string[]
  reportFile?: string
}

export interface LaunchResult {
  pid: number
  instanceId: string
}

export interface CreateInstanceInput {
  name: string
  mcVersion: string
  loader: Loader
  loaderVersion?: string
  memoryMb?: number
  icon?: string
}

/* ---------- API ---------- */

export interface SearchParams {
  query: string
  type: 'mod' | 'modpack' | 'resourcepack' | 'shader'
  gameVersion?: string
  loader?: Loader
  offset?: number
  limit?: number
  sort?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
}

export interface RelaxApi {
  app: {
    info(): Promise<{ version: string; root: string; platform: string; arch: string; electron: string }>
    system(): Promise<{ platform: string; arch: string; cpus: number; totalMemMb: number }>
    pathForFile(file: File): string
    openPath(kind: 'root' | 'instance' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'crashes' | 'logs' | 'screenshots' | 'saves', instanceId?: string): Promise<string>
    openExternal(url: string): Promise<void>
    pickDirectory(): Promise<string | null>
    pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
    clipboard(text: string): Promise<void>
  }
  state: {
    get(): Promise<AppState>
  }
  settings: {
    update(patch: Partial<Settings>): Promise<AppState>
    setBackground(filePath: string | null): Promise<AppState>
  }
  accounts: {
    add(name: string): Promise<AppState>
    elyLogin(login: string, password: string, totp?: string): Promise<AppState>
    remove(id: string): Promise<AppState>
    select(id: string): Promise<AppState>
    skin(name: string): Promise<SkinInfo>
  }
  versions: {
    manifest(refresh?: boolean): Promise<VersionManifest>
    installed(): Promise<string[]>
    fabricLoaders(mcVersion: string): Promise<{ version: string; stable: boolean }[]>
    forgeLoaders(mcVersion: string): Promise<{ version: string; stable: boolean; channel: string }[]>
    install(versionId: string): Promise<{ cancelled: boolean; alreadyRunning?: boolean }>
    remove(versionId: string): Promise<void>
  }
  download: {
    pause(taskId: string, paused: boolean): Promise<boolean>
    cancel(taskId: string): Promise<boolean>
  }
  instances: {
    create(input: CreateInstanceInput): Promise<Instance>
    update(id: string, patch: Partial<Instance>): Promise<AppState>
    remove(id: string): Promise<AppState>
    duplicate(id: string): Promise<AppState>
    select(id: string): Promise<AppState>
    size(id: string): Promise<number>
    export(id: string, options?: InstanceExportOptions): Promise<InstanceExportResult>
  }
  launch: {
    start(instanceId: string): Promise<LaunchResult>
    stop(instanceId: string): Promise<void>
    running(): Promise<string[]>
  }
  modrinth: {
    search(params: SearchParams): Promise<MrSearchResult>
    project(id: string): Promise<MrProject>
    versions(projectId: string, gameVersion?: string, loader?: Loader): Promise<MrVersion[]>
  }
  mods: {
    list(instanceId: string, kind?: ContentKind): Promise<ModInfo[]>
    install(instanceId: string, projectId: string, kind?: ContentKind): Promise<ModInfo[]>
    remove(instanceId: string, file: string, kind?: ContentKind): Promise<void>
    toggle(instanceId: string, file: string, enabled: boolean, kind?: ContentKind): Promise<void>
    optimizePlan(instanceId: string): Promise<OptimizeMod[]>
    optimizeApply(instanceId: string, slugs: string[]): Promise<{ installed: string[]; skipped: string[] }>
  }
  screenshots: {
    list(instanceId: string): Promise<ScreenshotInfo[]>
    remove(instanceId: string, file: string): Promise<void>
    open(instanceId: string, file: string): Promise<void>
  }
  downloads: {
    list(): Promise<DownloadRecord[]>
    clearHistory(): Promise<void>
    cacheInfo(): Promise<CacheInfo>
    clearCache(): Promise<CacheInfo>
  }
  modpacks: {
    install(projectId: string): Promise<ModpackInstallResult>
    installFile(filePath: string): Promise<ModpackInstallResult>
  }
  java: {
    detect(): Promise<JavaInfo[]>
    runtimes(): Promise<{ component: string; path: string }[]>
  }
  logs: {
    history(instanceId: string): Promise<LogEvent[]>
  }
  diagnostics: {
    crash(instanceId: string): Promise<CrashAnalysis>
  }
  update: {
    check(force?: boolean): Promise<UpdateInfo>
    download(): Promise<{ path: string }>
    install(): Promise<void>
    openRelease(): Promise<void>
    onProgress(cb: (e: UpdateProgress) => void): () => void
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximize(cb: (maximized: boolean) => void): () => void
  }
  on: {
    progress(cb: (e: ProgressEvent) => void): () => void
    download(cb: (e: { id: string; paused: boolean }) => void): () => void
    downloads(cb: (records: DownloadRecord[]) => void): () => void
    log(cb: (e: LogEvent) => void): () => void
    exit(cb: (e: ExitEvent) => void): () => void
    state(cb: (s: AppState) => void): () => void
  }
}
