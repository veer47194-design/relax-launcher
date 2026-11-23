import { useEffect, useMemo, useState } from 'react'
import type { Loader, VersionManifest } from '../../shared/types'
import { api, errText, fmtDate, loadManifest } from '../api'
import { useApp } from '../context'
import { Badge, Button, ConfirmButton, EmptyState, Icon, PageHeader, Spinner, Tabs, cx } from '../ui'
import { CreateInstanceModal } from '../components/create-instance'

type Tab = 'release' | 'snapshot' | 'all'

const TYPE_LABEL: Record<string, { label: string; tone: 'green' | 'amber' | 'neutral' }> = {
  release: { label: 'Релиз', tone: 'green' },
  snapshot: { label: 'Снапшот', tone: 'amber' },
  old_beta: { label: 'Beta', tone: 'neutral' },
  old_alpha: { label: 'Alpha', tone: 'neutral' },
}

export default function Versions() {
  const { toast, refresh } = useApp()
  const [manifest, setManifest] = useState<VersionManifest | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>('release')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(120)
  const [installing, setInstalling] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [createPreset, setCreatePreset] = useState<{ version: string; loader: Loader } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const openCreate = (version: string, loader: Loader = 'vanilla') => {
    setCreatePreset({ version, loader })
    setCreateOpen(true)
  }

  const loadInstalled = async () => {
    try {
      const list = await api.versions.installed()
      setInstalled(new Set(list))
    } catch {
      setInstalled(new Set())
    }
  }

  useEffect(() => {
    loadManifest()
      .then(setManifest)
      .catch((e) => toast(errText(e), 'err'))
    loadInstalled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const list = useMemo(() => {
    if (!manifest) return []
    const q = query.trim().toLowerCase()
    return manifest.versions.filter((v) => {
      if (tab === 'release' && v.type !== 'release') return false
      if (tab === 'snapshot' && v.type === 'release') return false
      if (q && !v.id.toLowerCase().includes(q)) return false
      return true
    })
  }, [manifest, tab, query])

  const shown = list.slice(0, limit)

  const install = async (id: string) => {
    setInstalling(id)
    try {
      const result = await api.versions.install(id)
      if (result.cancelled) {
        toast(`Скачивание Minecraft ${id} остановлено`, 'info')
        await loadInstalled()
        return
      }
      setInstalled((prev) => new Set(prev).add(id))
      toast(`Minecraft ${id} установлен`, 'ok')
      await refresh()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setInstalling(null)
    }
  }

  const remove = async (id: string) => {
    setRemoving(id)
    try {
      await api.versions.remove(id)
      setInstalled((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      toast(`Файлы Minecraft ${id} удалены`, 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setRemoving(null)
    }
  }

  const refreshManifest = async () => {
    setRefreshing(true)
    try {
      const m = await loadManifest(true)
      setManifest(m)
      toast('Список версий обновлён', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Версии Minecraft"
        subtitle="Все релизы и снапшоты напрямую с серверов Mojang"
        actions={
          <>
            <Button variant="soft" icon="refresh" loading={refreshing} onClick={refreshManifest}>
              Обновить
            </Button>
            <Button variant="primary" icon="plus" onClick={() => openCreate('')}>
              Новая сборка
            </Button>
          </>
        }
      />

      <div className="project-toolbar">
        <Tabs
          value={tab}
          onChange={(value) => {
            setTab(value)
            setLimit(120)
          }}
          items={[
            { value: 'release', label: 'Релизы' },
            { value: 'snapshot', label: 'Снапшоты' },
            { value: 'all', label: 'Все' },
          ]}
        />
        <div className="search" style={{ flex: 1, minWidth: 220 }}>
          <Icon name="search" size={17} />
          <input
            value={query}
            placeholder="Поиск версии, например 1.21.4"
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(120)
            }}
            spellCheck={false}
          />
        </div>
        {manifest && (
          <span className="tiny">
            Всего: {list.length} · последняя {manifest.latest.release}
          </span>
        )}
      </div>

      <div className="info-banner" style={{ marginBottom: 14 }}>
        <Icon name="info" size={17} />
        <div>
          Скачивать версию отдельно не обязательно: при первом запуске сборки все файлы и Java
          установятся автоматически. Кнопки справа создают сборку с нужным загрузчиком: Vanilla, Fabric
          или Forge.
        </div>
      </div>

      {!manifest ? (
        <div className="spinner-block">
          <Spinner size={22} /> Загрузка манифеста Mojang…
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="Версии не найдены" text="Попробуйте изменить запрос или вкладку." />
      ) : (
        <>
          <div className="version-list">
            {shown.map((v) => {
              const meta = TYPE_LABEL[v.type] ?? { label: v.type, tone: 'neutral' as const }
              const isInstalled = installed.has(v.id)
              return (
                <div key={v.id} className="version-row">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div>
                    <div className="version-id">{v.id}</div>
                    <div className="version-meta">{fmtDate(v.releaseTime)}</div>
                  </div>
                  <div className="version-actions">
                    {isInstalled && (
                      <Badge tone="green" className="hide-sm">
                        Установлено
                      </Badge>
                    )}
                    {v.id === manifest.latest.release && <Badge tone="accent">Последняя</Badge>}
                    <Button
                      size="sm"
                      variant={isInstalled ? 'ghost' : 'soft'}
                      icon={isInstalled ? 'refresh' : 'download'}
                      loading={installing === v.id}
                      onClick={() => install(v.id)}
                    >
                      {isInstalled ? 'Проверить' : 'Скачать'}
                    </Button>
                    {isInstalled && (
                      <ConfirmButton
                        size="sm"
                        confirmText="Удалить файлы?"
                        onConfirm={() => {
                          if (removing !== v.id) void remove(v.id)
                        }}
                      >
                        Удалить
                      </ConfirmButton>
                    )}
                    <div className="version-loader-actions">
                      <Button size="sm" variant="ghost" onClick={() => openCreate(v.id, 'vanilla')}>
                        Vanilla
                      </Button>
                      <Button size="sm" variant="soft" onClick={() => openCreate(v.id, 'fabric')}>
                        Fabric
                      </Button>
                      <Button size="sm" variant="soft" onClick={() => openCreate(v.id, 'forge')}>
                        Forge
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {shown.length < list.length && (
            <div className="load-more">
              <Button variant="soft" onClick={() => setLimit((n) => n + 150)}>
                Показать ещё ({list.length - shown.length})
              </Button>
            </div>
          )}
        </>
      )}

      <CreateInstanceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        presetVersion={createPreset?.version || undefined}
        presetLoader={createPreset?.loader}
      />
    </div>
  )
}
