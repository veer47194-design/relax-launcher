import { useCallback, useEffect, useRef, useState } from 'react'
import type { MrSearchHit } from '../../shared/types'
import { api, errText, fmtNumber } from '../api'
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
  SpinnerBlock,
  cx,
} from '../ui'

export default function Modpacks() {
  const { state, toast, refresh, selectInstance, go } = useApp()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'downloads' | 'newest' | 'updated'>('downloads')
  const [loader, setLoader] = useState<'' | 'fabric' | 'forge'>('')
  const [hits, setHits] = useState<MrSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(
    async (offset: number, reset: boolean) => {
      const request = ++requestRef.current
      setLoading(true)
      try {
        const result = await api.modrinth.search({
          query,
          type: 'modpack',
          loader: loader || undefined,
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
    [query, sort, loader, toast],
  )

  useEffect(() => {
    const timer = setTimeout(() => void load(0, true), query.trim() ? 420 : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  const install = async (hit: MrSearchHit) => {
    setInstalling(hit.project_id)
    try {
      const result = await api.modpacks.install(hit.project_id)
      await refresh()
      selectInstance(result.instance.id)
      toast(`Сборка «${result.instance.name}» установлена`, 'ok')
      go('instances')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setInstalling(null)
    }
  }

  const installedFor = (hit: MrSearchHit) =>
    state.instances.find((i) => i.modpack?.projectId === hit.project_id)

  const open = (instanceId: string) => {
    selectInstance(instanceId)
    go('instances')
  }

  const remove = async (hit: MrSearchHit, instanceId: string, name: string) => {
    if (removing) return
    setRemoving(hit.project_id)
    try {
      await api.instances.remove(instanceId)
      await refresh()
      toast(`Сборка «${name}» удалена`, 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setRemoving(null)
    }
  }

  const importFile = async () => {
    const file = await api.app.pickFile([{ name: 'Сборки Modrinth', extensions: ['mrpack'] }])
    if (!file) return
    setImporting(true)
    try {
      const result = await api.modpacks.installFile(file)
      await refresh()
      selectInstance(result.instance.id)
      toast(`Сборка «${result.instance.name}» импортирована`, 'ok')
      go('instances')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Сборки Modrinth"
        subtitle="Готовые модпаки: скачиваются целиком и появляются как отдельная сборка"
        actions={
          <Button variant="soft" icon="download" loading={importing} onClick={importFile}>
            Импорт .mrpack
          </Button>
        }
      />

      <div className="info-banner" style={{ marginBottom: 16 }}>
        <Icon name="package" size={17} />
        <div className="grow">
          Сборка устанавливается со всеми модами и настройками. Поддерживаются Fabric, Forge и
          Vanilla-паки; NeoForge и Quilt пока не запускаются.
        </div>
        <span className="banner-hint">Перетащите .mrpack в окно</span>
      </div>

      <div className="project-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Найти сборку: Better MC, Cobblemon…" />
        <div style={{ width: 180 }}>
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="downloads">По популярности</option>
            <option value="newest">Новые</option>
            <option value="updated">Обновлённые</option>
          </Select>
        </div>
        <div style={{ width: 180 }}>
          <Select value={loader} onChange={(e) => setLoader(e.target.value as '' | 'fabric' | 'forge')}>
            <option value="">Все загрузчики</option>
            <option value="fabric">Fabric</option>
            <option value="forge">Forge</option>
          </Select>
        </div>
        <span className="tiny">{total > 0 ? `${fmtNumber(total)} сборок` : ''}</span>
      </div>

      {loading && hits.length === 0 ? (
        <SpinnerBlock text="Поиск сборок в Modrinth…" />
      ) : hits.length === 0 ? (
        <EmptyState
          icon="package"
          title="Сборки не найдены"
          text="Попробуйте изменить запрос или выбрать другой загрузчик."
        />
      ) : (
        <>
          <div className="project-grid">
            {hits.map((hit) => {
              const local = installedFor(hit)
              return (
                <Card
                  key={hit.project_id}
                  className={cx('project-card card-hover', local ? 'installed' : undefined)}
                >
                  <div className="project-top">
                    <RemoteIcon src={hit.icon_url} fallback={hit.title} size={56} radius={14} />
                    <div className="grow">
                      <div className="project-title" style={{ fontSize: 15 }}>
                        {hit.title}
                      </div>
                      <div className="project-author">от {hit.author}</div>
                      <div className="row" style={{ gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                        {(hit.display_categories ?? hit.categories).slice(0, 3).map((c) => (
                          <Badge key={c}>{c}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="project-desc" style={{ minHeight: 50, WebkitLineClamp: 3 }}>
                    {hit.description}
                  </div>
                  <div className="project-foot">
                    <span className="project-stats">
                      <Icon name="download" size={13} /> {fmtNumber(hit.downloads)}
                    </span>
                    {local ? (
                      <>
                        <Badge tone="green">Скачано</Badge>
                        <div className="project-actions">
                          <Button size="sm" variant="soft" icon="arrowRight" onClick={() => open(local.id)}>
                            Открыть
                          </Button>
                          <ConfirmButton
                            size="sm"
                            confirmText="Удалить?"
                            onConfirm={() => void remove(hit, local.id, local.name)}
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
