import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, ProgressEvent } from '../shared/types'
import { api, cx, errText } from './api'
import { AppContext, useApp, type ModsTab, type Page, type ToastItem, type ToastKind } from './context'
import { applyAppearance } from './theme'
import { Head, Icon, LogoMark, ProgressBar, Spinner } from './ui'
import { WelcomeScreen } from './components/welcome'
import { UpdateBanner } from './components/update-banner'
import Home from './pages/Home'
const Instances = lazy(() => import('./pages/Instances'))
const Versions = lazy(() => import('./pages/Versions'))
const Mods = lazy(() => import('./pages/Mods'))
const Modpacks = lazy(() => import('./pages/Modpacks'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Downloads = lazy(() => import('./pages/Downloads'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const Screenshots = lazy(() => import('./pages/Screenshots'))
const ConsolePage = lazy(() => import('./pages/Console'))

const NAV: { group: string; items: { page: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] }[] = [
  {
    group: 'Игра',
    items: [
      { page: 'home', label: 'Главная', icon: 'home' },
      { page: 'instances', label: 'Сборки', icon: 'layers' },
      { page: 'versions', label: 'Версии', icon: 'grid' },
    ],
  },
  {
    group: 'Контент',
    items: [
      { page: 'mods', label: 'Моды', icon: 'puzzle' },
      { page: 'modpacks', label: 'Сборки Modrinth', icon: 'package' },
      { page: 'resourcepacks', label: 'Ресурс-паки', icon: 'box' },
      { page: 'shaders', label: 'Шейдеры', icon: 'sparkles' },
    ],
  },
  {
    group: 'Прочее',
    items: [
      { page: 'accounts', label: 'Аккаунты', icon: 'user' },
      { page: 'screenshots', label: 'Скриншоты', icon: 'camera' },
      { page: 'downloads', label: 'Загрузки', icon: 'download' },
      { page: 'console', label: 'Консоль', icon: 'terminal' },
      { page: 'settings', label: 'Настройки', icon: 'settings' },
    ],
  },
]

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [selected, setSelected] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [launching, setLaunching] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [modsTab, setModsTab] = useState<ModsTab>('catalog')
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pausedDownloads, setPausedDownloads] = useState<Set<string>>(new Set())
  const [welcome, setWelcome] = useState(true)
  const [warningHidden, setWarningHidden] = useState(false)

  const contentRef = useRef<HTMLDivElement | null>(null)
  const toastId = useRef(0)
  const handledProgress = useRef<Set<string>>(new Set())
  const pendingProgress = useRef<ProgressEvent | null>(null)
  const rafRef = useRef<number | null>(null)
  const stateRef = useRef<AppState | null>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (state) applyAppearance(state.settings)
  }, [
    state?.settings.theme,
    state?.settings.accentColor,
    state?.settings.background,
    state?.settings.backgroundImage,
    state?.settings.wallpaperOpacity,
    state?.settings.uiDensity,
    state?.settings.fontSize,
    state?.settings.fontFamily,
    state?.settings.reduceMotion,
  ])

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++toastId.current
    setToasts((prev) => [...prev.slice(-3), { id, text, kind }])
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      kind === 'err' ? 8500 : 4500,
    )
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const closeWelcome = useCallback(() => setWelcome(false), [])

  const refresh = useCallback(async () => {
    const next = await api.state.get()
    setState(next)
  }, [])

  const applyState = useCallback((next: AppState) => {
    setState(next)
    setSelected((prev) =>
      prev && next.instances.some((i) => i.id === prev)
        ? prev
        : (next.settings.activeInstanceId ?? next.instances[0]?.id ?? null),
    )
  }, [])

  const load = useCallback(() => {
    setLoadError(null)
    api.state
      .get()
      .then((next) => {
        setState(next)
        setSelected(next.settings.activeInstanceId ?? next.instances[0]?.id ?? null)
      })
      .catch((e) => setLoadError(errText(e)))
  }, [])

  useEffect(() => {
    load()
    api.launch
      .running()
      .then((ids) => setRunning(new Set(ids)))
      .catch(() => {})

    const offState = api.on.state((next) => applyState(next))
    const offDownload = api.on.download(({ id, paused }) => {
      setPausedDownloads((prev) => {
        const next = new Set(prev)
        if (paused) next.add(id)
        else next.delete(id)
        return next
      })
    })
    const offProgress = api.on.progress((event) => {
      if (event.done) {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        pendingProgress.current = null
        setProgress(event)
        if (event.error) {
          if (!handledProgress.current.has(event.id)) {
            handledProgress.current.add(event.id)
            toast(event.error, 'err')
          }
          window.setTimeout(() => {
            setProgress((current) => (current?.id === event.id ? null : current))
          }, 10000)
        } else {
          window.setTimeout(() => {
            setProgress((current) => (current?.id === event.id ? null : current))
          }, 2400)
        }
        return
      }
      // Прогресс приходит очень часто — обновляем интерфейс не чаще одного кадра.
      pendingProgress.current = event
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (pendingProgress.current) setProgress(pendingProgress.current)
      })
    })
    const offLog = api.on.exit((event) => {
      setRunning((prev) => {
        const next = new Set(prev)
        next.delete(event.instanceId)
        return next
      })
      if (event.code !== 0) {
        const time = event.crashedAt
          ? new Date(event.crashedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : ''
        const suspect = event.suspects?.[0] ? ` · подозревается: ${event.suspects[0]}` : ''
        toast(`Произошёл краш${time ? ` в ${time}` : ''}${suspect}`, 'err')
      } else if (event.hints.length > 0) {
        toast(event.hints[0], 'err')
      }
    })

    return () => {
      offState()
      offDownload()
      offProgress()
      offLog()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [applyState, load, toast])

  const start = useCallback(
    async (instanceId: string) => {
      setLaunching(instanceId)
      try {
        await api.launch.start(instanceId)
        setRunning((prev) => new Set(prev).add(instanceId))
        setSelected(instanceId)
        if (stateRef.current?.settings.showConsole) setPage('console')
      } catch (e) {
        toast(errText(e), 'err')
      } finally {
        setLaunching(null)
      }
    },
    [toast],
  )

  const stop = useCallback(
    async (instanceId: string) => {
      try {
        await api.launch.stop(instanceId)
        toast('Останавливаем игру…', 'info')
      } catch (e) {
        toast(errText(e), 'err')
      }
    },
    [toast],
  )

  const go = useCallback(
    (next: Page) => {
      if (next === 'resourcepacks') setModsTab('resourcepacks')
      else if (next === 'shaders') setModsTab('shaders')
      else if (next === 'mods') setModsTab('catalog')
      setPage(next)
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [setModsTab],
  )

  const setDownloadPaused = useCallback(
    async (id: string, paused: boolean) => {
      try {
        await api.download.pause(id, paused)
      } catch (e) {
        toast(errText(e), 'err')
      }
    },
    [toast],
  )

  const cancelDownload = useCallback(
    async (id: string) => {
      try {
        await api.download.cancel(id)
        setPausedDownloads((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setProgress(null)
      } catch (e) {
        toast(errText(e), 'err')
      }
    },
    [toast],
  )

  const selectInstance = useCallback((id: string) => {
    setSelected(id)
    api.instances
      .select(id)
      .then(setState)
      .catch(() => {})
  }, [])

  const openConsole = useCallback((id: string) => {
    setSelected(id)
    setPage('console')
  }, [])

  const importPack = useCallback(
    async (filePath: string) => {
      if (!/\.mrpack$/i.test(filePath)) {
        toast('Перетащите файл сборки .mrpack', 'err')
        return
      }
      setImporting(true)
      try {
        const result = await api.modpacks.installFile(filePath)
        await refresh()
        setSelected(result.instance.id)
        setPage('instances')
        toast(`Сборка «${result.instance.name}» импортирована`, 'ok')
      } catch (e) {
        toast(errText(e), 'err')
      } finally {
        setImporting(false)
      }
    },
    [refresh, toast],
  )

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      void importPack(api.app.pathForFile(file))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [importPack])

  useEffect(() => {
    const pages = NAV.flatMap((group) => group.items.map((item) => item.page))
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key === ',') {
        e.preventDefault()
        setPage('settings')
        return
      }
      const digit = e.key === '0' ? 10 : Number(e.key)
      const index = digit - 1
      if (Number.isInteger(digit) && index >= 0 && index < pages.length) {
        e.preventDefault()
        setPage(pages[index])
        contentRef.current?.scrollTo({ top: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const instance = useMemo(
    () => (state ? (state.instances.find((i) => i.id === selected) ?? null) : null),
    [state, selected],
  )

  const ctx = useMemo(
    () =>
      state
        ? {
            state,
            setState,
            refresh,
            page,
            go,
            selectedInstance: selected,
            selectInstance,
            instance,
            progress,
            dismissProgress: () => setProgress(null),
            running,
            launching,
            start,
            stop,
            toast,
            modsTab,
            setModsTab,
            openConsole,
          }
        : null,
    [
      state,
      refresh,
      page,
      go,
      selected,
      selectInstance,
      instance,
      progress,
      running,
      launching,
      start,
      stop,
      toast,
      modsTab,
      openConsole,
    ],
  )

  if (loadError) {
    return (
      <div className="splash">
        <div className="splash-mark">!</div>
        <h2>Не удалось загрузить лаунчер</h2>
        <p>{loadError}</p>
        <button className="btn btn-primary btn-md" onClick={load}>
          Повторить
        </button>
      </div>
    )
  }

  if (!state || !ctx) {
    return (
      <div className="splash">
        <div className="splash-mark">
          <LogoMark size={34} />
        </div>
        <h2>Relax Launcher</h2>
        <div className="row" style={{ color: 'var(--muted)' }}>
          <Spinner size={16} /> Загрузка…
        </div>
      </div>
    )
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        {welcome && (
          <WelcomeScreen onDone={closeWelcome} reduced={!!state.settings.reduceMotion} />
        )}
        {state.settings.backgroundImage && (
          <div
            className="bg-photo"
            style={{
              backgroundImage: `url("relax-bg://local/${encodeURIComponent(state.settings.backgroundImage)}")`,
            }}
          />
        )}
        <TitleBar />
        <div className="shell">
          <Sidebar />
          <main className="content" ref={contentRef}>
            <div className="content-inner">
              {state.warning && !warningHidden && (
                <div className="config-warning">
                  <Icon name="alert" size={15} />
                  <div className="grow">{state.warning}</div>
                  <button className="icon-btn" onClick={() => setWarningHidden(true)} aria-label="Скрыть">
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )}
              <div className="page-stage" key={page}>
                <Suspense fallback={<div className="page-loading"><Spinner size={18} /> Загрузка раздела…</div>}>
                  {page === 'home' && <Home />}
                  {page === 'instances' && <Instances />}
                  {page === 'versions' && <Versions />}
                  {page === 'mods' && <Mods title="Моды" initialTab="catalog" />}
                  {page === 'modpacks' && <Modpacks />}
                  {page === 'resourcepacks' && <Mods title="Ресурс-паки" initialTab="resourcepacks" />}
                  {page === 'shaders' && <Mods title="Шейдеры" initialTab="shaders" />}
                  {page === 'accounts' && <Accounts />}
                  {page === 'screenshots' && <Screenshots />}
                  {page === 'downloads' && <Downloads />}
                  {page === 'settings' && <SettingsPage />}
                  {page === 'console' && <ConsolePage />}
                </Suspense>
              </div>
            </div>
          </main>
        </div>

        {dragging && (
          <div className="drop-overlay">
            <div className="drop-card">
              <button
                className="drop-close"
                aria-label="Закрыть подсказку"
                title="Закрыть"
                onClick={() => {
                  dragDepth.current = 0
                  setDragging(false)
                }}
              >
                <Icon name="x" size={16} />
              </button>
              <div className="drop-icon">
                <Icon name="package" size={34} />
              </div>
              <h2>Отпустите .mrpack</h2>
              <p>Сборка установится как новая и сразу появится в разделе «Сборки»</p>
            </div>
          </div>
        )}

        {importing && (
          <div className="import-pill">
            <Spinner size={14} /> Импорт сборки…
          </div>
        )}

        <div className="toast-host">
          {toasts.map((item) => (
            <div key={item.id} className={cx('toast', `toast-${item.kind}`)}>
              <Icon
                name={item.kind === 'ok' ? 'check' : item.kind === 'err' ? 'alert' : 'info'}
                size={16}
              />
              <div className="grow">{item.text}</div>
              <button className="icon-btn" onClick={() => dismissToast(item.id)} aria-label="Закрыть">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>

        {progress && (
          <ProgressToast
            progress={progress}
            paused={pausedDownloads.has(progress.id)}
            onPause={(paused) => setDownloadPaused(progress.id, paused)}
            onCancel={() => cancelDownload(progress.id)}
            onClose={() => setProgress(null)}
          />
        )}

        <UpdateBanner />
      </div>
    </AppContext.Provider>
  )
}

function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => api.window.onMaximize(setMaximized), [])
  return (
    <div className="titlebar">
      <div className="tb-brand">
        <span className="tb-dot" />
        Relax Launcher
      </div>
      <div className="tb-controls">
        <button onClick={() => api.window.minimize()} title="Свернуть">
          <Icon name="minimize" size={15} />
        </button>
        <button onClick={() => api.window.toggleMaximize()} title={maximized ? 'Восстановить' : 'Развернуть'}>
          <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
        </button>
        <button className="tb-close" onClick={() => api.window.close()} title="Закрыть">
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  )
}

function Sidebar() {
  const { state, page, go, running, openConsole, instance } = useApp()
  const [version, setVersion] = useState('')
  useEffect(() => {
    api.app
      .info()
      .then((info) => setVersion(info.version))
      .catch(() => {})
  }, [])
  const account = state.accounts.find((a) => a.id === state.settings.activeAccountId) ?? state.accounts[0]
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <LogoMark size={24} />
        </div>
        <div className="brand-text">
          <strong>RELAX</strong>
          <span>Launcher</span>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((group) => (
          <div className="nav-group" key={group.group}>
            <div className="nav-label">{group.group}</div>
            {group.items.map((item) => {
              const isConsole = item.page === 'console'
              return (
                <button
                  key={item.page}
                  className={cx('nav-item', page === item.page && 'active')}
                  onClick={() => go(item.page)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {item.page === 'instances' && state.instances.length > 0 && (
                    <span className="nav-count">{state.instances.length}</span>
                  )}
                  {isConsole && running.size > 0 && <span className="nav-live" />}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        {running.size > 0 && (
          <button className="running-note" onClick={() => openConsole([...running][0])}>
            <span className="nav-live" />
            <span>Игра запущена</span>
          </button>
        )}
        <button className="account-chip" onClick={() => go('accounts')}>
          {account ? (
            <Head name={account.name} size={34} />
          ) : (
            <span className="head head-fallback" style={{ width: 34, height: 34 }}>
              ?
            </span>
          )}
          <div className="account-chip-info">
            <strong>{account?.name ?? 'Нет аккаунта'}</strong>
            <span>{account ? (account.type === 'ely' ? 'Ely.by' : 'Офлайн-аккаунт') : 'Нажмите, чтобы добавить'}</span>
          </div>
          {!account && (
            <span className="plus-badge">
              <Icon name="plus" size={14} />
            </span>
          )}
        </button>
        {instance && <div className="tiny" style={{ padding: '8px 10px 0' }}>Сборка: {instance.name}</div>}
        {version && <div className="sidebar-version">Relax Launcher v{version}</div>}
      </div>
    </aside>
  )
}

function ProgressToast({
  progress,
  paused,
  onPause,
  onCancel,
  onClose,
}: {
  progress: ProgressEvent
  paused: boolean
  onPause: (paused: boolean) => void
  onCancel: () => void
  onClose: () => void
}) {
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const remaining = Math.max(0, Math.ceil(progress.total - progress.current))
  const controllable = progress.id.startsWith('install:') && !progress.done && !progress.error
  return (
    <div className={cx('progress-toast', progress.error && 'error', paused && 'paused')}>
      <div className="progress-toast-head">
        {progress.error ? (
          <Icon name="alert" size={16} />
        ) : progress.done ? (
          <Icon name="check" size={16} />
        ) : paused ? (
          <Icon name="pause" size={15} />
        ) : (
          <Spinner size={15} />
        )}
        <span className="grow">{progress.error ?? progress.title}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Скрыть">
          <Icon name="x" size={13} />
        </button>
      </div>
      {!progress.error && <ProgressBar value={progress.current} max={progress.total || 1} />}
      <div className="progress-toast-detail">
        <span>{progress.error ?? (progress.done ? 'Готово' : paused ? 'На паузе' : progress.phase)}</span>
        <span>
          {!progress.done && progress.total > 0
            ? `${percent}% · осталось ${remaining}`
            : ''}
        </span>
      </div>
      {progress.detail && !progress.done && !progress.error && (
        <div className="progress-toast-detail">
          <span>{progress.detail}</span>
        </div>
      )}
      {controllable && (
        <div className="progress-toast-actions">
          <button className="progress-action" onClick={() => onPause(!paused)}>
            <Icon name={paused ? 'play' : 'pause'} size={12} />
            {paused ? 'Продолжить' : 'Пауза'}
          </button>
          <button className="progress-action danger" onClick={onCancel}>
            <Icon name="stop" size={11} />
            Остановить
          </button>
        </div>
      )}
    </div>
  )
}
