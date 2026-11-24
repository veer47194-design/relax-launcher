import { useCallback, useEffect, useRef, useState } from 'react'
import type { Instance, ModInfo, MrSearchHit, OptimizeMod } from '../../shared/types'
import type { ModsTab } from '../context'
import { api, errText, fmtBytes, fmtNumber, loaderLabel } from '../api'
import { findInstalledContent } from '../content'
import { useApp } from '../context'
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Icon,
  PageHeader,
  RemoteIcon,
  SearchInput,
  Select,
  Spinner,
  SpinnerBlock,
  Tabs,
  Toggle,
  cx,
} from '../ui'

function ModIcon({
  mod,
  fallback = 'puzzle',
}: {
  mod: ModInfo
  fallback?: Parameters<typeof Icon>[0]['name']
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [mod.iconUrl])
  return (
    <div className="mod-icon">
      {mod.iconUrl && !failed ? (
        <img
          className="mod-icon-img"
          src={mod.iconUrl}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name={fallback} size={18} />
      )}
    </div>
  )
}

export default function Mods({
  title = 'Моды',
  initialTab,
}: {
  title?: string
  initialTab?: ModsTab
} = {}) {  const { state, instance, selectInstance, modsTab, setModsTab, toast, go } = useApp()
  const [installed, setInstalled] = useState<ModInfo[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (initialTab) setModsTab(initialTab)
  }, [initialTab, setModsTab])

  const loadInstalled = useCallback(async () => {
    if (!instance) return
    setLoading(true)
    try {
      setInstalled(await api.mods.list(instance.id))
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setLoading(false)
    }
  }, [instance?.id, toast])

  useEffect(() => {
    void loadInstalled()
  }, [loadInstalled])

  if (!instance) {
    return (
      <div>
        <PageHeader title={title} subtitle="Моды, ресурс-паки и шейдеры из Modrinth" />
        <EmptyState
          icon="puzzle"
          title="Сначала создайте сборку"
          text="Моды устанавливаются в конкретную сборку. Создайте сборку Fabric или Forge — и каталог Modrinth станет доступен."
          action={
            <Button variant="primary" icon="plus" onClick={() => go('instances')}>
              Перейти к сборкам
            </Button>
          }
        />
      </div>
    )
  }

  const isFabric = instance.loader === 'fabric'
  const isModded = instance.loader !== 'vanilla'
  const assetPage = initialTab === 'resourcepacks' || initialTab === 'shaders' ? initialTab : null
  const folderKind = assetPage === 'resourcepacks' ? 'resourcepacks' : assetPage === 'shaders' ? 'shaderpacks' : 'mods'
  const folderLabel =
    folderKind === 'resourcepacks' ? 'Папка ресурс-паков' : folderKind === 'shaderpacks' ? 'Папка шейдеров' : 'Папка модов'

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`${instance.name} · Minecraft ${instance.mcVersion} · ${loaderLabel(instance.loader, instance.loaderVersion)}`}
        actions={
          <>
            <div style={{ width: 230 }}>
              <Select value={instance.id} onChange={(e) => selectInstance(e.target.value)}>
                {state.instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant="soft"
              icon="folder"
              onClick={() => api.app.openPath(folderKind, instance.id)}
            >
              {folderLabel}
            </Button>
          </>
        }
      />

      {!assetPage && (
        <div style={{ marginBottom: 16 }}>
          <Tabs
            value={modsTab}
            onChange={setModsTab}
            items={[
              { value: 'catalog', label: 'Каталог', icon: 'search' },
              { value: 'installed', label: 'Установленные', icon: 'puzzle', badge: installed.length },
              { value: 'optimize', label: 'Оптимизация', icon: 'sparkles' },
            ]}
          />
        </div>
      )}

      {!isModded && (
        <div className="info-banner warn" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={17} />
          <div className="grow">
            В сборке Vanilla нельзя использовать моды. Создайте сборку с загрузчиком Fabric или Forge —
            моды станут доступны.
          </div>
          <Button size="sm" variant="soft" onClick={() => go('instances')}>
            К сборкам
          </Button>
        </div>
      )}

      {modsTab === 'catalog' && (
        <CatalogTab
          instance={instance}
          enabled={isModded}
          installed={installed}
          onChanged={loadInstalled}
        />
      )}
      {modsTab === 'installed' && (
        <InstalledTab
          instance={instance}
          mods={installed}
          loading={loading}
          reload={loadInstalled}
          onBrowse={() => setModsTab('catalog')}
        />
      )}
      {(modsTab === 'resourcepacks' || modsTab === 'shaders') && (
        <AssetTab
          instance={instance}
          kind={modsTab === 'resourcepacks' ? 'resourcepack' : 'shader'}
        />
      )}
      {modsTab === 'optimize' && (
        <OptimizeTab instance={instance} enabled={isFabric} onInstalled={loadInstalled} />
      )}
    </div>
  )
}

/* ------------------------------ Каталог ------------------------------ */

function CatalogTab({
  instance,
  enabled,
  installed,
  onChanged,
}: {
  instance: Instance
  enabled: boolean
  installed: ModInfo[]
  onChanged: () => void
}) {
  const { toast } = useApp()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'downloads' | 'newest' | 'updated'>('downloads')
  const [hits, setHits] = useState<MrSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(
    async (offset: number, reset: boolean) => {
      const request = ++requestRef.current
      setLoading(true)
      try {
        const result = await api.modrinth.search({
          query,
          type: 'mod',
          gameVersion: instance.mcVersion,
          loader: instance.loader === 'forge' ? 'forge' : 'fabric',
          offset,
          limit: 24,
          sort: query.trim() ? 'relevance' : sort,
        })
        if (request !== requestRef.current) return
        setHits((prev) => (reset ? result.hits : [...prev, ...result.hits]))
        setTotal(result.total_hits)
      } catch (e) {
        if (request === requestRef.current) toast(errText(e), 'err')
      } finally {
        if (request === requestRef.current) setLoading(false)
      }
    },
    [query, sort, instance.mcVersion, instance.loader, toast],
  )

  useEffect(() => {
    const timer = setTimeout(() => void load(0, true), query.trim() ? 420 : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  const install = async (hit: MrSearchHit) => {
    setInstalling(hit.project_id)
    try {
      await api.mods.install(instance.id, hit.project_id)
      toast(`«${hit.title}» установлен`, 'ok')
      onChanged()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setInstalling(null)
    }
  }

  const remove = async (hit: MrSearchHit, mod: ModInfo) => {
    if (removing) return
    setRemoving(hit.project_id)
    try {
      await api.mods.remove(instance.id, mod.file)
      toast(`«${hit.title}» удалён`, 'ok')
      onChanged()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div>
      <div className="project-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Название мода, например Sodium" />
        <div style={{ width: 180 }}>
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="downloads">По популярности</option>
            <option value="newest">Новые</option>
            <option value="updated">Обновлённые</option>
          </Select>
        </div>
        <span className="tiny">
          {total > 0 ? `${fmtNumber(total)} модов для ${instance.mcVersion}` : `Minecraft ${instance.mcVersion} · Fabric`}
        </span>
      </div>

      {loading && hits.length === 0 ? (
        <SpinnerBlock text="Поиск в Modrinth…" />
      ) : hits.length === 0 ? (
        <EmptyState
          icon="search"
          title="Ничего не найдено"
          text="Попробуйте другой запрос или проверьте версию Minecraft в сборке."
        />
      ) : (
        <>
          <div className="project-grid">
            {hits.map((hit) => {
              const local = findInstalledContent(hit, installed)
              return (
                <Card
                  key={hit.project_id}
                  className={cx('project-card card-hover', local ? 'installed' : undefined)}
                >
                  <div className="project-top">
                    <RemoteIcon src={hit.icon_url} fallback={hit.title} size={46} />
                    <div className="grow">
                      <div className="project-title">{hit.title}</div>
                      <div className="project-author">от {hit.author}</div>
                    </div>
                  </div>
                  <div className="project-desc">{hit.description}</div>
                  <div className="project-foot">
                    <span className="project-stats">
                      <Icon name="download" size={13} /> {fmtNumber(hit.downloads)}
                    </span>
                    {(hit.display_categories ?? hit.categories).slice(0, 2).map((c) => (
                      <Badge key={c}>{c}</Badge>
                    ))}
                    {local ? (
                      <>
                        <Badge tone="green">Скачано</Badge>
                        <div className="project-actions">
                          <ConfirmButton
                            size="sm"
                            confirmText="Удалить?"
                            onConfirm={() => void remove(hit, local)}
                          >
                            Удалить
                          </ConfirmButton>
                        </div>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="download"
                        disabled={!enabled}
                        loading={installing === hit.project_id}
                        onClick={() => install(hit)}
                      >
                        Установить
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
          {hits.length < total && (
            <div className="load-more">
              <Button variant="soft" loading={loading} onClick={() => load(hits.length, false)}>
                Показать ещё
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------------------- Установленные ---------------------------- */

function InstalledTab({
  instance,
  mods,
  loading,
  reload,
  onBrowse,
}: {
  instance: Instance
  mods: ModInfo[]
  loading: boolean
  reload: () => void
  onBrowse: () => void
}) {
  const { toast } = useApp()

  const toggle = async (mod: ModInfo, enabled: boolean) => {
    try {
      await api.mods.toggle(instance.id, mod.file, enabled)
      reload()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const remove = async (mod: ModInfo) => {
    try {
      await api.mods.remove(instance.id, mod.file)
      toast(`«${mod.name}» удалён`, 'ok')
      reload()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  if (loading && mods.length === 0) return <SpinnerBlock text="Чтение папки модов…" />

  if (mods.length === 0) {
    return (
      <EmptyState
        icon="puzzle"
        title="В этой сборке пока нет модов"
        text="Откройте каталог Modrinth или установите готовый набор оптимизации в один клик."
        action={
          <div className="row">
            <Button variant="primary" icon="search" onClick={onBrowse}>
              Открыть каталог
            </Button>
          </div>
        }
      />
    )
  }

  const enabledCount = mods.filter((m) => m.enabled).length

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <span className="tiny">
          {mods.length} файлов · включено {enabledCount}
        </span>
        <div className="row">
          <Button size="sm" variant="ghost" icon="folder" onClick={() => api.app.openPath('mods', instance.id)}>
            Папка
          </Button>
          <Button size="sm" variant="ghost" icon="refresh" onClick={reload}>
            Обновить
          </Button>
        </div>
      </div>
      <div className="mod-list">
        {mods.map((mod) => (
          <div key={mod.file} className={cx('mod-row', !mod.enabled && 'disabled')}>
            <ModIcon mod={mod} />
            <div className="grow">
              <div className="mod-name">
                {mod.name}
                {mod.version && <span className="tiny">{mod.version}</span>}
                {!mod.enabled && <Badge tone="neutral">Отключён</Badge>}
              </div>
              <div className="mod-file">
                {mod.file} · {fmtBytes(mod.size)}
              </div>
            </div>
            <Toggle checked={mod.enabled} onChange={(value) => toggle(mod, value)} />
            <ConfirmButton size="sm" onConfirm={() => remove(mod)} confirmText="Удалить?">
              Удалить
            </ConfirmButton>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ----------------------------- Оптимизация ----------------------------- */

function OptimizeTab({
  instance,
  enabled,
  onInstalled,
}: {
  instance: Instance
  enabled: boolean
  onInstalled: () => void
}) {
  const { toast } = useApp()
  const [plan, setPlan] = useState<OptimizeMod[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.mods
      .optimizePlan(instance.id)
      .then((list) => {
        if (cancelled) return
        setPlan(list)
        setSelected(new Set(list.map((m) => m.slug)))
      })
      .catch((e) => !cancelled && toast(errText(e), 'err'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instance.id, toast])

  const toggle = (slug: string, value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (value) next.add(slug)
      else next.delete(slug)
      return next
    })
  }

  const apply = async () => {
    setApplying(true)
    try {
      const result = await api.mods.optimizeApply(instance.id, [...selected])
      const skipped = result.skipped.length ? ` · пропущено: ${result.skipped.length}` : ''
      toast(`Готово! Установлено модов: ${result.installed.length}${skipped}`, 'ok')
      onInstalled()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setApplying(false)
    }
  }

  if (!enabled) {
    return (
      <EmptyState
        icon="sparkles"
        title="Оптимизация доступна для Fabric"
        text="Создайте сборку с загрузчиком Fabric, и лаунчер установит Sodium, Lithium и другие оптимизации автоматически."
      />
    )
  }

  return (
    <div className="stack">
      <Card
        className="card-pad"
        style={{
          background:
            'linear-gradient(135deg, rgba(124,92,255,.18), rgba(56,189,248,.07) 60%, transparent), var(--panel)',
          borderColor: 'rgba(124,92,255,.28)',
        }}
      >
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 18 }}>
          <div>
            <div className="row" style={{ gap: 9 }}>
              <Icon name="sparkles" size={20} />
              <h2 style={{ fontSize: 20, letterSpacing: '-0.02em' }}>FPS Boost</h2>
            </div>
            <p className="muted" style={{ marginTop: 7, maxWidth: 640 }}>
              Проверенный набор оптимизационных модов для Fabric. Ставится в один клик, не меняет
              геймплей и легко отключается. Для слабых ПК прирост может достигать 2–3 раз.
            </p>
          </div>
          <Button
            variant="primary"
            icon="download"
            loading={applying}
            disabled={selected.size === 0 || loading}
            onClick={apply}
          >
            Установить {selected.size}
          </Button>
        </div>
      </Card>

      {loading ? (
        <SpinnerBlock text="Подбор модов для вашей версии…" />
      ) : (
        <>
          <div className="row-between">
            <span className="tiny">Выбрано {selected.size} из {plan.length}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(selected.size === plan.length ? new Set() : new Set(plan.map((m) => m.slug)))}
            >
              {selected.size === plan.length ? 'Снять все' : 'Выбрать все'}
            </Button>
          </div>
          <div className="mod-list">
            {plan.map((mod) => (
              <div key={mod.slug} className="mod-row">
                <div className="mod-icon">
                  <Icon name="sparkles" size={18} />
                </div>
                <div className="grow">
                  <div className="mod-name">
                    {mod.title}
                    {mod.optional && <Badge tone="neutral">опционально</Badge>}
                  </div>
                  <div className="mod-file" style={{ fontFamily: 'inherit', maxWidth: 720 }}>
                    {mod.description}
                  </div>
                </div>
                <Toggle checked={selected.has(mod.slug)} onChange={(value) => toggle(mod.slug, value)} />
              </div>
            ))}
          </div>
          {plan.length === 0 && (
            <div className="tiny">Для этой версии Minecraft пока нет готового набора оптимизаций.</div>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------------- Ресурс-паки и шейдеры ---------------------- */

function AssetTab({ instance, kind }: { instance: Instance; kind: 'resourcepack' | 'shader' }) {
  const { toast } = useApp()
  const folder = kind === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'
  const label = kind === 'resourcepack' ? 'ресурс-пак' : 'шейдер'

  const [query, setQuery] = useState('')
  const [view, setView] = useState<'catalog' | 'installed'>('catalog')
  const [hits, setHits] = useState<MrSearchHit[]>([])
  const [installed, setInstalled] = useState<ModInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const requestRef = useRef(0)

  const loadInstalled = useCallback(async () => {
    try {
      setInstalled(await api.mods.list(instance.id, kind))
    } catch (e) {
      toast(errText(e), 'err')
    }
  }, [instance.id, kind, toast])

  useEffect(() => {
    void loadInstalled()
  }, [loadInstalled])

  const load = useCallback(
    async (offset: number, reset: boolean) => {
      const request = ++requestRef.current
      setLoading(true)
      try {
        const result = await api.modrinth.search({
          query,
          type: kind,
          gameVersion: instance.mcVersion,
          offset,
          limit: 24,
          sort: query.trim() ? 'relevance' : 'downloads',
        })
        if (request !== requestRef.current) return
        setHits((prev) => (reset ? result.hits : [...prev, ...result.hits]))
      } catch (e) {
        if (request === requestRef.current) toast(errText(e), 'err')
      } finally {
        if (request === requestRef.current) setLoading(false)
      }
    },
    [query, kind, instance.mcVersion, toast],
  )

  useEffect(() => {
    const timer = setTimeout(() => void load(0, true), query.trim() ? 420 : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  const install = async (hit: MrSearchHit) => {
    setInstalling(hit.project_id)
    try {
      await api.mods.install(instance.id, hit.project_id, kind)
      toast(`«${hit.title}» установлен`, 'ok')
      await loadInstalled()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setInstalling(null)
    }
  }

  const toggle = async (item: ModInfo, enabled: boolean) => {
    try {
      await api.mods.toggle(instance.id, item.file, enabled, kind)
      await loadInstalled()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const remove = async (item: ModInfo) => {
    try {
      await api.mods.remove(instance.id, item.file, kind)
      toast(`«${item.name}» удалён`, 'ok')
      await loadInstalled()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  return (
    <div className="stack">
      <div style={{ marginBottom: 4 }}>
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: 'catalog', label: 'Каталог', icon: 'search' },
            { value: 'installed', label: 'Установленные', icon: 'puzzle', badge: installed.length },
          ]}
        />
      </div>

      {view === 'catalog' ? (
        <>
          <div className="project-toolbar">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={kind === 'resourcepack' ? 'Название ресурс-пака…' : 'Название шейдера…'}
            />
            <Button size="sm" variant="ghost" icon="folder" onClick={() => api.app.openPath(folder, instance.id)}>
              Папка {folder}
            </Button>
            <span className="tiny">Каталог Modrinth · {label}ы</span>
          </div>

          {loading && hits.length === 0 ? (
            <SpinnerBlock text="Поиск в Modrinth…" />
          ) : hits.length === 0 ? (
            <EmptyState
              icon="search"
              title="Ничего не найдено"
              text="Попробуйте другой запрос или проверьте версию Minecraft в сборке."
            />
          ) : (
            <>
              <div className="project-grid">
                {hits.map((hit) => {
                  const local = findInstalledContent(hit, installed)
                  return (
                    <Card
                      key={hit.project_id}
                      className={cx('project-card card-hover', local ? 'installed' : undefined)}
                    >
                      <div className="project-top">
                        <RemoteIcon src={hit.icon_url} fallback={hit.title} size={46} />
                        <div className="grow">
                          <div className="project-title">{hit.title}</div>
                          <div className="project-author">от {hit.author}</div>
                        </div>
                      </div>
                      <div className="project-desc">{hit.description}</div>
                      <div className="project-foot">
                        <span className="project-stats">
                          <Icon name="download" size={13} /> {fmtNumber(hit.downloads)}
                        </span>
                        {local ? (
                          <>
                            <Badge tone="green">Скачано</Badge>
                            <div className="project-actions">
                              <ConfirmButton
                                size="sm"
                                confirmText="Удалить?"
                                onConfirm={() => remove(local)}
                              >
                                Удалить
                              </ConfirmButton>
                            </div>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            icon="download"
                            loading={installing === hit.project_id}
                            onClick={() => install(hit)}
                          >
                            Установить
                          </Button>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>
              {hits.length > 0 && (
                <div className="load-more">
                  <Button variant="soft" loading={loading} onClick={() => load(hits.length, false)}>
                    Показать ещё
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <span className="tiny">
              {installed.length} файлов · Minecraft {instance.mcVersion}
            </span>
            <div className="row">
              <Button size="sm" variant="ghost" icon="folder" onClick={() => api.app.openPath(folder, instance.id)}>
                Папка
              </Button>
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void loadInstalled()}>
                Обновить
              </Button>
            </div>
          </div>

          {installed.length === 0 ? (
            <EmptyState
              icon="box"
              title={`Нет установленных ${kind === 'resourcepack' ? 'ресурс-паков' : 'шейдеров'}`}
              text={`Откройте каталог и установите ${label} из Modrinth.`}
              action={
                <Button variant="primary" icon="search" onClick={() => setView('catalog')}>
                  Открыть каталог
                </Button>
              }
            />
          ) : (
            <div className="mod-list">
              {installed.map((item) => (
                <div key={item.file} className={cx('mod-row', !item.enabled && 'disabled')}>
                  <ModIcon mod={item} fallback={kind === 'resourcepack' ? 'box' : 'sparkles'} />
                  <div className="grow">
                    <div className="mod-name">
                      {item.name}
                      {!item.enabled && <Badge tone="neutral">Отключён</Badge>}
                    </div>
                    <div className="mod-file">
                      {item.file} · {fmtBytes(item.size)}
                    </div>
                  </div>
                  <Toggle checked={item.enabled} onChange={(value) => toggle(item, value)} />
                  <ConfirmButton size="sm" confirmText="Удалить?" onConfirm={() => remove(item)}>
                    Удалить
                  </ConfirmButton>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
