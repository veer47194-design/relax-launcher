import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ArgEntry,
  ExitEvent,
  GcPreset,
  Instance,
  LaunchResult,
  LogEvent,
  ResolvedVersion,
  Settings,
} from '../shared/types'
import { config, ensureInstanceDirs } from './config'
import { analyzeCrash } from './crash'
import { ELY_INJECTOR_URL, ensureAuthlibInjector, refreshElyAccount } from './ely'
import { ensureFabricVersion } from './fabric'
import { ensureForgeVersion } from './forge'
import { ensureDir } from './fsutil'
import { selectJava } from './java'
import { sanitizeModFileNames } from './mods'
import { defaultFeatures, installVersion, materializeLegacyResources, rulesAllow } from './mojang'
import { p } from './paths'
import { Progress, broadcast } from './progress'

const MAX_LOG_LINES = 6000

interface RunningProcess {
  child: ChildProcess
  startedAt: number
  instanceId: string
  closeTimer?: NodeJS.Timeout
}

function gcFlags(preset: GcPreset, javaMajor: number): string[] {
  if (preset === 'off') return []
  if (preset === 'zgc') {
    if (javaMajor < 21) return gcFlags('balanced', javaMajor)
    return javaMajor >= 23 ? ['-XX:+UseZGC'] : ['-XX:+UseZGC', '-XX:+ZGenerational']
  }
  const flags = [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
  ]
  if (preset === 'balanced') {
    return [
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=20',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:SurvivorRatio=32',
      '-XX:MaxTenuringThreshold=1',
    ]
  }
  return [...flags, '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true']
}

function substitute(value: string, vars: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_m, key: string) => vars[key] ?? '')
}

function expandArgs(entries: ArgEntry[], vars: Record<string, string>, features: Record<string, boolean>): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(entry)
      continue
    }
    if (!rulesAllow(entry.rules, features)) continue
    const values = Array.isArray(entry.value) ? entry.value : [entry.value]
    out.push(...values)
  }
  return out.map((v) => substitute(v, vars))
}

export interface LaunchPlan {
  javaPath: string
  args: string[]
  gameDir: string
  versionId: string
  classpath: string[]
}

export function buildLaunchPlan(
  installed: Awaited<ReturnType<typeof installVersion>>,
  instance: Instance,
  settings: Settings,
  javaPath: string,
  javaMajor: number,
  account: { name: string; uuid: string; accessToken?: string },
  elyAgentPath?: string | null,
): LaunchPlan {
  const version: ResolvedVersion = installed.version
  const gameDir = p.instance(instance.id)
  const resolution = instance.resolution ?? settings.resolution
  const useCustomResolution = resolution.width > 0 && resolution.height > 0
  const features = defaultFeatures(useCustomResolution ? resolution : null)

  const classpathEntries = [...installed.libraryPaths, installed.clientJar]
  const classpath = classpathEntries.join(path.delimiter)

  const logConfigPath = version.logging
    ? path.join(installed.assetsDir, 'log_configs', version.logging.file.id)
    : ''

  const token = account.accessToken ?? '0'
  const vars: Record<string, string> = {
    auth_player_name: account.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: installed.assetsDir,
    assets_index_name: version.assetIndexId,
    auth_uuid: account.uuid,
    auth_access_token: token,
    auth_session: `token:${token}:${account.uuid}`,
    clientid: '',
    auth_xuid: '',
    user_type: account.accessToken ? 'mojang' : 'legacy',
    version_type: version.type,
    natives_directory: installed.nativesDir,
    launcher_name: 'RelaxLauncher',
    launcher_version: app.getVersion(),
    classpath,
    classpath_separator: path.delimiter,
    library_directory: p.libraries(),
    game_assets: installed.gameAssetsDir ?? path.join(installed.assetsDir, 'virtual', version.assetIndexId),
    user_properties: '{}',
    path: logConfigPath,
    resolution_width: String(resolution.width),
    resolution_height: String(resolution.height),
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: '',
    quickPlayRealms: '',
  }

  const jvm = version.jvmArgs.length > 0 ? expandArgs(version.jvmArgs, vars, features) : []
  if (elyAgentPath) {
    jvm.unshift(`-javaagent:${elyAgentPath}=${ELY_INJECTOR_URL}`)
  }
  if (!jvm.some((a) => a === '-cp' || a === '-classpath')) jvm.push('-cp', classpath)
  if (!jvm.some((a) => a.startsWith('-Djava.library.path='))) {
    jvm.push(`-Djava.library.path=${installed.nativesDir}`)
  }
  if (version.logging) {
    jvm.push(substitute(version.logging.argument, vars))
  }

  const gameArgs =
    version.gameArgs.length > 0
      ? expandArgs(version.gameArgs, vars, features)
      : (version.minecraftArguments ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((v) => substitute(v, vars))

  if (resolution.fullscreen && !gameArgs.includes('--fullscreen')) gameArgs.push('--fullscreen')

  const memory = instance.memoryMb ?? settings.memoryMb
  const minMemory = Math.min(settings.minMemoryMb, memory)
  const preset = instance.gcPreset ?? settings.gcPreset

  const extra = [
    `-Xms${minMemory}M`,
    `-Xmx${memory}M`,
    ...gcFlags(preset, javaMajor),
    '-Dfile.encoding=UTF-8',
    '-Djava.awt.headless=false',
    '-Dlog4j2.formatMsgNoLookups=true',
    '-Dminecraft.launcher.brand=Relax Launcher',
    `-Dminecraft.launcher.version=${app.getVersion()}`,
    ...(settings.customJvmArgs ? settings.customJvmArgs.split(/\s+/).filter(Boolean) : []),
  ]

  return {
    javaPath,
    args: [...jvm, ...extra, version.mainClass, ...gameArgs],
    gameDir,
    versionId: version.id,
    classpath: classpathEntries,
  }
}

export class Launcher {
  private running = new Map<string, RunningProcess>()
  private logs = new Map<string, LogEvent[]>()
  /** Логи отправляются пачками: поток модов легко выдаёт тысячи строк в секунду. */
  private pendingLogs = new Map<string, LogEvent[]>()
  private logTimers = new Map<string, NodeJS.Timeout>()

  isRunning(instanceId: string): boolean {
    return this.running.has(instanceId)
  }

  runningIds(): string[] {
    return [...this.running.keys()]
  }

  history(instanceId: string): LogEvent[] {
    return this.logs.get(instanceId) ?? []
  }

  clearHistory(instanceId: string) {
    this.logs.set(instanceId, [])
  }

  async start(instanceId: string): Promise<LaunchResult> {
    if (this.running.has(instanceId)) throw new Error('Эта сборка уже запущена')
    const cfg = config()
    const instance = cfg.getInstance(instanceId)
    let account = cfg.activeAccount()
    if (!account) throw new Error('Сначала добавьте аккаунт во вкладке «Аккаунты»')

    await ensureInstanceDirs(instanceId)
    if (instance.loader === 'forge') {
      // Чинимlegacy-паки: имена с `[1.20.1]` ломают JPMS-модули Forge.
      const renamed = await sanitizeModFileNames(instanceId)
      if (renamed.length > 0) {
        this.pushLog(instanceId, {
          instanceId,
          stream: 'system',
          at: Date.now(),
          line: `[Relax] Для Forge переименованы файлы: ${renamed.join('; ')}`,
        })
      }
    }
    const progress = new Progress(`launch:${instanceId}`, `Запуск «${instance.name}»`)

    try {
      let elyAgentPath: string | null = null
      if (account.type === 'ely') {
        progress.phase('ely', 1)
        progress.note('Проверка сессии Ely.by')
        const refreshed = await refreshElyAccount(account)
        cfg.updateAccount(account.id, {
          name: refreshed.name,
          uuid: refreshed.uuid,
          accessToken: refreshed.accessToken,
          clientToken: refreshed.clientToken,
          lastLogin: refreshed.lastLogin,
        })
        account = refreshed
        elyAgentPath = await ensureAuthlibInjector(progress)
      }

      let versionId = instance.mcVersion
      if (instance.loader === 'fabric') {
        const fabric = await ensureFabricVersion(instance.mcVersion, instance.loaderVersion)
        versionId = fabric.id
        if (instance.loaderVersion !== fabric.loader) cfg.updateInstance(instanceId, { loaderVersion: fabric.loader })
      } else if (instance.loader === 'forge') {
        const forge = await ensureForgeVersion(
          instance.mcVersion,
          instance.loaderVersion,
          progress,
          instance.javaPath,
        )
        versionId = forge.id
        if (instance.loaderVersion !== forge.loader) cfg.updateInstance(instanceId, { loaderVersion: forge.loader })
      }

      const installed = await installVersion(versionId, progress)
      const java = await selectJava(
        installed.version.javaComponent,
        installed.version.javaMajor,
        instance.javaPath,
        progress,
      )

      for (const sub of ['java', 'jna', 'lwjgl', 'netty']) {
        await ensureDir(path.join(installed.nativesDir, sub))
      }

      const settings = cfg.get().settings
      const plan = buildLaunchPlan(
        installed,
        instance,
        settings,
        java.java.path,
        java.java.major,
        account,
        elyAgentPath,
      )

      if (installed.mapToResources) {
        await materializeLegacyResources(installed.version.assetIndex, path.join(plan.gameDir, 'resources'))
      }

      const loaderLabel =
        instance.loader === 'fabric'
          ? `Fabric ${instance.loaderVersion ?? ''}`.trim()
          : instance.loader === 'forge'
            ? `Forge ${instance.loaderVersion ?? ''}`.trim()
            : 'Vanilla'

      progress.phase('launch')
      progress.note(`Java ${java.java.major} · ${instance.memoryMb ?? settings.memoryMb} МБ ОЗУ`)
      this.pushLog(instanceId, {
        instanceId,
        stream: 'system',
        at: Date.now(),
        line: `[Relax] Minecraft ${instance.mcVersion} · ${loaderLabel} · Java ${java.java.version}${java.note ? ` (${java.note})` : ''}${account.type === 'ely' ? ' · Ely.by' : ''}`,
      })

      const logFile = path.join(p.logs(), `${instanceId}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
      await ensureDir(p.logs())
      const logStream = fs.createWriteStream(logFile, { flags: 'a' })

      const child = spawn(plan.javaPath, plan.args, {
        cwd: plan.gameDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      const startedAt = Date.now()
      const entry: RunningProcess = { child, startedAt, instanceId }
      this.running.set(instanceId, entry)
      let finished = false

      const finish = async (code: number | null, spawnError?: string) => {
        if (finished) return
        finished = true
        if (entry.closeTimer) {
          clearTimeout(entry.closeTimer)
          entry.closeTimer = undefined
        }
        const exitAt = Date.now()
        const durationMs = exitAt - startedAt
        try {
          logStream.end()
        } catch {
          /* поток мог быть уже закрыт */
        }
        this.flushLogs(instanceId)
        this.running.delete(instanceId)
        let event: ExitEvent
        if (spawnError) {
          event = { instanceId, code: -1, durationMs, hints: [spawnError], reason: spawnError }
        } else {
          const lines = (this.logs.get(instanceId) ?? []).map((l) => l.line)
          const crash = code === 0 ? null : await analyzeCrash(instanceId, lines, startedAt, exitAt)
          event = {
            instanceId,
            code,
            durationMs,
            hints: crash?.hints ?? [],
            crashedAt: crash?.crashedAt,
            reason: crash?.reason,
            suspects: crash?.suspects,
            reportFile: crash?.reportFile,
          }
        }
        this.pushLog(instanceId, {
          instanceId,
          stream: 'system',
          at: exitAt,
          line: spawnError
            ? `[Relax] ${spawnError}`
            : `[Relax] Игра завершилась с кодом ${code ?? '—'} за ${Math.round(durationMs / 1000)} с${event.crashedAt ? ` · краш в ${new Date(event.crashedAt).toLocaleTimeString('ru-RU')}` : ''}`,
        })
        if (durationMs > 1000 || !spawnError) cfg.markPlayed(instanceId, durationMs)
        broadcast('launch:exit', event)
        broadcast('state', cfg.state())
        if (cfg.get().settings.closeLauncherOnStart) {
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isMinimized()) win.restore()
            win.show()
          }
        }
      }

      const stdout = child.stdout
      const stderr = child.stderr
      // Если диск не успевает писать лог, приостанавливаем чтение pipe игры.
      // Иначе буфер pipe заполняется, Java блокируется на записи в консоль
      // и окно Minecraft показывает «Не отвечает».
      let drainWaiting = false
      const pauseForDrain = () => {
        if (drainWaiting) return
        drainWaiting = true
        stdout?.pause()
        stderr?.pause()
        logStream.once('drain', () => {
          drainWaiting = false
          stdout?.resume()
          stderr?.resume()
        })
      }

      const makeHandler = (stream: 'stdout' | 'stderr') => {
        let buffer = ''
        return (chunk: Buffer) => {
          buffer += chunk.toString('utf8')
          const parts = buffer.split(/\r\n|\n|\r/)
          buffer = parts.pop() ?? ''
          for (const line of parts) {
            if (!line.trim()) continue
            if (!logStream.write(`${line}\n`)) pauseForDrain()
            this.pushLog(instanceId, { instanceId, stream, line, at: Date.now() })
          }
        }
      }
      stdout?.on('data', makeHandler('stdout'))
      stderr?.on('data', makeHandler('stderr'))

      // Ждём именно событие spawn: при ошибке (нет Java, PATH, доступ) Node не шлёт exit,
      // и раньше лаунчер показывал «игра запущена», хотя процесс не создан.
      const spawnError = await new Promise<string | null>((resolve) => {
        const onSpawn = () => {
          child.off('error', onError)
          resolve(null)
        }
        const onError = (err: Error) => {
          child.off('spawn', onSpawn)
          resolve(`Не удалось запустить Java: ${err.message}`)
        }
        child.once('spawn', onSpawn)
        child.once('error', onError)
      })

      if (spawnError) {
        progress.fail(spawnError)
        this.pushLog(instanceId, { instanceId, stream: 'system', line: spawnError, at: Date.now() })
        await finish(-1, spawnError)
        throw new Error(spawnError)
      }

      child.on('error', (err) => {
        const message = `Процесс игры завершился с ошибкой: ${err.message}`
        progress.fail(message)
        void finish(-1, message).catch((e) => console.error('[launch] finish', e))
      })
      child.on('exit', (code) => {
        void finish(code).catch((e) => console.error('[launch] finish', e))
      })

      progress.done('Игра запущена')
      if (settings.closeLauncherOnStart) {
        entry.closeTimer = setTimeout(() => {
          entry.closeTimer = undefined
          for (const win of BrowserWindow.getAllWindows()) win.minimize()
        }, 1200)
      }

      return { pid: child.pid ?? 0, instanceId }
    } catch (e) {
      const message = (e as Error).message
      progress.fail(message)
      throw e
    }
  }

  stop(instanceId: string): void {
    const entry = this.running.get(instanceId)
    if (!entry) return
    const pid = entry.child.pid
    if (pid) {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true })
        killer.on('error', (e) => console.error('[launch] taskkill', e))
      } else {
        entry.child.kill('SIGTERM')
      }
    }
    this.pushLog(instanceId, {
      instanceId,
      stream: 'system',
      line: '[Relax] Остановка игры по запросу пользователя',
      at: Date.now(),
    })
  }

  private pushLog(instanceId: string, event: LogEvent) {
    const list = this.logs.get(instanceId) ?? []
    list.push(event)
    if (list.length > MAX_LOG_LINES) list.splice(0, list.length - MAX_LOG_LINES)
    this.logs.set(instanceId, list)

    const pending = this.pendingLogs.get(instanceId) ?? []
    pending.push(event)
    this.pendingLogs.set(instanceId, pending)
    if (!this.logTimers.has(instanceId)) {
      const timer = setTimeout(() => {
        this.logTimers.delete(instanceId)
        this.flushLogs(instanceId)
      }, 80)
      this.logTimers.set(instanceId, timer)
    }
  }

  /** Отправляет накопленные строки сразу — перед событием выхода или остановкой. */
  private flushLogs(instanceId: string) {
    const timer = this.logTimers.get(instanceId)
    if (timer) {
      clearTimeout(timer)
      this.logTimers.delete(instanceId)
    }
    const pending = this.pendingLogs.get(instanceId)
    this.pendingLogs.delete(instanceId)
    if (pending?.length) broadcast('launch:logs', pending)
  }
}

export const launcher = new Launcher()
