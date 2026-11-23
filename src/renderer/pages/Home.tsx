import { useEffect, useState } from 'react'
import type { VersionManifest } from '../../shared/types'
import { api, fmtDate, fmtPlaytime, loadManifest, loaderLabel, timeAgo } from '../api'
import { useApp } from '../context'
import { themeById } from '../theme'
import { Badge, Button, Card, EmptyState, Icon, PageHeader } from '../ui'
import { CreateInstanceModal } from '../components/create-instance'
import { InstanceSettingsModal } from '../components/instance-settings'

export default function Home() {
  const { state, instance, running, launching, start, stop, go, setModsTab, openConsole, selectInstance } = useApp()
  const [manifest, setManifest] = useState<VersionManifest | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modCount, setModCount] = useState<number | null>(null)
  const [sys, setSys] = useState<{ cpus: number; totalMemMb: number; platform: string; arch: string } | null>(null)

  useEffect(() => {
    api.app
      .system()
      .then(setSys)
      .catch(() => setSys(null))
  }, [])

  useEffect(() => {
    loadManifest()
      .then(setManifest)
      .catch(() => setManifest(null))
  }, [])

  useEffect(() => {
    if (!instance) return
    let cancelled = false
    setModCount(null)
    api.mods
      .list(instance.id)
      .then((mods) => !cancelled && setModCount(mods.filter((m) => m.enabled).length))
      .catch(() => !cancelled && setModCount(null))
    return () => {
      cancelled = true
    }
  }, [instance?.id])

  const account = state.accounts.find((a) => a.id === state.settings.activeAccountId)
  const latestReleases = manifest?.versions.filter((v) => v.type === 'release').slice(0, 5) ?? []
  const isRunning = instance ? running.has(instance.id) : false
  const isLaunching = instance ? launching === instance.id : false
  const memory = instance?.memoryMb ?? state.settings.memoryMb
  const platformLabel =
    sys?.platform === 'win32'
      ? 'Windows'
      : sys?.platform === 'darwin'
        ? 'macOS'
        : sys?.platform === 'linux'
          ? 'Linux'
          : 'Система'
  const themeName = themeById(state.settings.theme).name
  const customAccent = state.settings.accentColor

  const playButton = instance ? (
    !account ? (
      <Button variant="primary" className="btn-play" icon="user" onClick={() => go('accounts')}>
        Добавить аккаунт
      </Button>
    ) : isRunning ? (
      <Button variant="primary" className="btn-play btn-stop" icon="stop" onClick={() => stop(instance.id)}>
        Остановить
      </Button>
    ) : (
      <Button
        variant="primary"
        className="btn-play"
        icon="play"
        loading={isLaunching}
        onClick={() => start(instance.id)}
      >
        {isLaunching ? 'Запуск…' : 'Играть'}
      </Button>
    )
  ) : null

  return (
    <div>
      <PageHeader
        title="Главная"
        subtitle="Всё готово к игре — выберите сборку и нажмите «Играть»"
        actions={
          <Button variant="soft" icon="plus" onClick={() => setCreateOpen(true)}>
            Новая сборка
          </Button>
        }
      />

      <div className="sys-strip">
        <span className="sys-chip">
          <Icon name="cpu" size={14} />
          {sys ? <b>{sys.cpus} ядер</b> : 'CPU'}
        </span>
        <span className="sys-chip">
          <Icon name="memory" size={14} />
          {sys ? <b>{Math.round(sys.totalMemMb / 1024)} ГБ</b> : 'ОЗУ'}
        </span>
        <span className="sys-chip">
          <Icon name="grid" size={14} />
          {platformLabel}
          {sys?.arch ? ` · ${sys.arch}` : ''}
        </span>
        <button
          className="sys-chip sys-chip-action"
          onClick={() => go('settings')}
          title="Настроить тему и оформление"
        >
          <Icon name="sparkles" size={14} />
          {customAccent ? (
            <>
              Акцент <b>{customAccent}</b>
            </>
          ) : (
            <>
              Тема <b>{themeName}</b>
            </>
          )}
        </button>
        <span className="sys-hint">
          <kbd>Ctrl</kbd>+<kbd>1…0</kbd> разделы · <kbd>Ctrl</kbd>+<kbd>,</kbd> настройки
        </span>
      </div>

      {!account && (
        <div className="info-banner warn" style={{ marginBottom: 14 }}>
          <Icon name="user" size={17} />
          <div className="grow">
            Добавьте офлайн-аккаунт — он нужен для входа в игру и сохранения прогресса.
          </div>
          <Button size="sm" variant="soft" onClick={() => go('accounts')}>
            Добавить
          </Button>
        </div>
      )}

      {instance ? (
        <div className="hero">
          <Card className="hero-main">
            <div className="hero-top">
              <div className="hero-icon">
                {instance.modpack?.iconUrl ? (
                  <img src={instance.modpack.iconUrl} alt="" />
                ) : (
                  instance.icon
                )}
              </div>
              <div className="hero-info">
                <div className="hero-kicker">Текущая сборка</div>
                <div className="hero-title">{instance.name}</div>
                <div className="hero-chips">
                  <Badge tone="accent">Minecraft {instance.mcVersion}</Badge>
                  <Badge>{loaderLabel(instance.loader, instance.loaderVersion)}</Badge>
                  <Badge>{memory} МБ</Badge>
                  {isRunning && <Badge tone="green">В игре</Badge>}
                </div>
              </div>
            </div>
            <div className="hero-bottom">
              {playButton}
              <Button variant="soft" icon="settings" onClick={() => setSettingsOpen(true)}>
                Настройки
              </Button>
              <Button variant="ghost" icon="terminal" onClick={() => openConsole(instance.id)}>
                Консоль
              </Button>
              <Button
                variant="ghost"
                icon="folder"
                onClick={() => api.app.openPath('instance', instance.id)}
                title="Открыть папку сборки"
              >
                Папка
              </Button>
            </div>
          </Card>

          <Card className="hero-side">
            <div className="stat">
              <div className="stat-icon">
                <Icon name="clock" size={17} />
              </div>
              <div className="stat-info">
                <strong>{timeAgo(instance.lastPlayed)}</strong>
                <span>Последний запуск</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-icon">
                <Icon name="grid" size={17} />
              </div>
              <div className="stat-info">
                <strong>{fmtPlaytime(instance.playtimeMs)}</strong>
                <span>Всего в игре</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-icon">
                <Icon name="puzzle" size={17} />
              </div>
              <div className="stat-info">
                <strong>{instance.loader !== 'vanilla' ? (modCount ?? '…') : '—'}</strong>
                <span>{instance.loader !== 'vanilla' ? 'Активных модов' : 'Vanilla без модов'}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-icon">
                <Icon name="memory" size={17} />
              </div>
              <div className="stat-info">
                <strong>{memory} МБ</strong>
                <span>Выделено памяти</span>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="hero-main">
          <div>
            <div className="hero-kicker">Добро пожаловать</div>
            <div className="hero-title" style={{ fontSize: 34, whiteSpace: 'normal' }}>
              Соберите свою идеальную Minecraft
            </div>
            <p className="muted" style={{ marginTop: 10, maxWidth: 620 }}>
              Vanilla, Fabric, моды и готовые сборки с Modrinth — в одном лаунчере. Java и все файлы
              скачиваются автоматически, а встроенный FPS Boost выжимает максимум из вашего ПК.
            </p>
            <div className="hero-chips" style={{ marginTop: 16 }}>
              <Badge tone="accent">Minecraft 26.3+</Badge>
              <Badge>Fabric</Badge>
              <Badge>Modrinth</Badge>
              <Badge tone="green">Офлайн-аккаунты</Badge>
            </div>
          </div>
          <div className="hero-bottom">
            <Button variant="primary" className="btn-play" icon="plus" onClick={() => setCreateOpen(true)}>
              Создать первую сборку
            </Button>
            <Button variant="soft" icon="user" onClick={() => go('accounts')}>
              Добавить аккаунт
            </Button>
          </div>
        </Card>
      )}

      <div className="section-title">
        <h2>Быстрый доступ</h2>
      </div>
      <div className="quick-grid">
        <Card
          className="quick card-hover"
          role="button"
          tabIndex={0}
          onClick={() => setCreateOpen(true)}
        >
          <div className="quick-icon">
            <Icon name="plus" size={20} />
          </div>
          <div className="quick-text">
            <strong>Новая сборка</strong>
            <span>Vanilla или Fabric</span>
          </div>
          <Icon name="arrowRight" size={16} className="arrow" />
        </Card>
        <Card
          className="quick card-hover"
          role="button"
          tabIndex={0}
          onClick={() => {
            setModsTab('catalog')
            go('mods')
          }}
        >
          <div className="quick-icon">
            <Icon name="puzzle" size={20} />
          </div>
          <div className="quick-text">
            <strong>Моды Modrinth</strong>
            <span>Тысячи модов в один клик</span>
          </div>
          <Icon name="arrowRight" size={16} className="arrow" />
        </Card>
        <Card
          className="quick card-hover"
          role="button"
          tabIndex={0}
          onClick={() => {
            setModsTab('optimize')
            go('mods')
          }}
        >
          <div className="quick-icon">
            <Icon name="sparkles" size={20} />
          </div>
          <div className="quick-text">
            <strong>FPS Boost</strong>
            <span>Sodium, Lithium и другие</span>
          </div>
          <Icon name="arrowRight" size={16} className="arrow" />
        </Card>
        <Card
          className="quick card-hover"
          role="button"
          tabIndex={0}
          onClick={() => go('modpacks')}
        >
          <div className="quick-icon">
            <Icon name="package" size={20} />
          </div>
          <div className="quick-text">
            <strong>Сборки Modrinth</strong>
            <span>Готовые модпаки</span>
          </div>
          <Icon name="arrowRight" size={16} className="arrow" />
        </Card>
      </div>

      <div className="section-title">
        <h2>Последние версии Minecraft</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => go('versions')}>
          Все версии <Icon name="chevronRight" size={14} />
        </button>
      </div>
      {latestReleases.length === 0 ? (
        <div className="spinner-block">Загрузка манифеста Mojang…</div>
      ) : (
        <div className="version-list">
          {latestReleases.map((v) => (
            <div key={v.id} className="version-row">
              <span className="version-id">{v.id}</span>
              <span className="version-meta">
                <span className="dot" />
                {fmtDate(v.releaseTime)}
              </span>
              <div className="version-actions">
                <Button size="sm" variant="soft" icon="plus" onClick={() => setCreateOpen(true)}>
                  Сборка
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {state.instances.length > 1 && (
        <>
          <div className="section-title">
            <h2>Мои сборки</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => go('instances')}>
              Управление <Icon name="chevronRight" size={14} />
            </button>
          </div>
          <div className="instance-grid">
            {state.instances.slice(0, 3).map((i) => (
              <Card
                key={i.id}
                className={`instance-card card-hover${i.id === instance?.id ? ' active' : ''}`}
                onClick={() => selectInstance(i.id)}
              >
                <div className="instance-head">
                  <div className="instance-icon">
                    {i.modpack?.iconUrl ? <img src={i.modpack.iconUrl} alt="" /> : i.icon}
                  </div>
                  <div className="grow">
                    <div className="instance-name">{i.name}</div>
                    <div className="instance-sub">
                      <span>Minecraft {i.mcVersion}</span>
                      <span className="dot" />
                      <span>{loaderLabel(i.loader, i.loaderVersion)}</span>
                    </div>
                  </div>
                </div>
                <div className="instance-actions">
                  <Button
                    size="sm"
                    variant={i.id === instance?.id ? 'primary' : 'soft'}
                    icon="play"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectInstance(i.id)
                      start(i.id)
                    }}
                  >
                    Играть
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <CreateInstanceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => selectInstance(created.id)}
      />
      <InstanceSettingsModal
        instance={instance}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
