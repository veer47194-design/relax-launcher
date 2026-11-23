import { useCallback, useEffect, useState } from 'react'
import type { CacheInfo, DownloadRecord, DownloadStatus } from '../../shared/types'
import { api, errText, fmtBytes } from '../api'
import { useApp } from '../context'
import { Badge, Button, Card, ConfirmButton, EmptyState, Icon, PageHeader, ProgressBar, cx } from '../ui'

const STATUS: Record<DownloadStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' | 'accent' }> = {
  active: { label: 'Загружается', tone: 'accent' },
  paused: { label: 'На паузе', tone: 'amber' },
  done: { label: 'Готово', tone: 'green' },
  error: { label: 'Ошибка', tone: 'red' },
  cancelled: { label: 'Остановлено', tone: 'neutral' },
}

export default function Downloads() {
  const { toast } = useApp()
  const [records, setRecords] = useState<DownloadRecord[]>([])
  const [cache, setCache] = useState<CacheInfo | null>(null)

  const reloadCache = useCallback(() => {
    api.downloads
      .cacheInfo()
      .then(setCache)
      .catch((e) => toast(errText(e), 'err'))
  }, [toast])

  useEffect(() => {
    const offList = api.on.downloads(setRecords)
    reloadCache()
    return () => {
      offList()
    }
  }, [reloadCache])

  const togglePause = async (record: DownloadRecord) => {
    const next = record.status === 'paused' ? false : true
    try {
      await api.download.pause(record.id, next)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const cancel = async (record: DownloadRecord) => {
    try {
      await api.download.cancel(record.id)
      toast('Загрузка остановлена', 'info')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const clearCache = async () => {
    try {
      const freed = await api.downloads.clearCache()
      setCache(await api.downloads.cacheInfo())
      toast(`Освобождено ${fmtBytes(freed.totalBytes)}`, 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const clearHistory = async () => {
    try {
      await api.downloads.clearHistory()
      toast('История очищена', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const active = records.filter((r) => r.status === 'active' || r.status === 'paused')

  return (
    <div>
      <PageHeader
        title="Загрузки и кэш"
        subtitle="Активные задачи, история загрузок и временные файлы"
        actions={
          <>
            <Button variant="soft" icon="refresh" onClick={reloadCache}>
              Обновить
            </Button>
            <ConfirmButton
              icon="trash"
              confirmText={`Удалить ${cache ? fmtBytes(cache.totalBytes) : ''}?`}
              onConfirm={() => void clearCache()}
            >
              Очистить кэш
            </ConfirmButton>
          </>
        }
      />

      <div className="cache-grid" style={{ marginBottom: 18 }}>
        <Card className="cache-tile accent">
          <Icon name="download" size={19} />
          <div>
            <strong>{cache ? fmtBytes(cache.totalBytes) : '…'}</strong>
            <span>Всего можно освободить</span>
          </div>
        </Card>
        <Card className="cache-tile">
          <Icon name="box" size={19} />
          <div>
            <strong>{cache ? fmtBytes(cache.partsBytes) : '…'}</strong>
            <span>
              Временные .part · {cache?.partsFiles ?? 0}
            </span>
          </div>
        </Card>
        <Card className="cache-tile">
          <Icon name="layers" size={19} />
          <div>
            <strong>{cache ? fmtBytes(cache.installersBytes) : '…'}</strong>
            <span>
              Инсталляторы Forge · {cache?.installersFiles ?? 0}
            </span>
          </div>
        </Card>
        <Card className="cache-tile">
          <Icon name="package" size={19} />
          <div>
            <strong>{cache ? fmtBytes(cache.modpacksBytes) : '…'}</strong>
            <span>
              Архивы .mrpack · {cache?.modpacksFiles ?? 0}
            </span>
          </div>
        </Card>
      </div>

      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 16 }}>Активные загрузки</h2>
          <span className="tiny">Сейчас загружается: {active.length}</span>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="info-banner" style={{ marginBottom: 18 }}>
          <Icon name="check" size={17} />
          <div>Сейчас нет активных загрузок.</div>
        </div>
      ) : (
        <div className="download-list" style={{ marginBottom: 18 }}>
          {active.map((record) => {
            const percent = record.total > 0 ? Math.round((record.current / record.total) * 100) : 0
            return (
              <Card key={record.id} className="download-row">
                <Icon name={record.status === 'paused' ? 'pause' : 'download'} size={18} />
                <div className="grow">
                  <div className="download-title">{record.title}</div>
                  <div className="download-meta">
                    {record.kind} · {record.detail ?? STATUS[record.status].label} · {percent}%
                  </div>
                  <ProgressBar value={record.current} max={record.total || 1} />
                </div>
                <div className="download-actions">
                  <Button size="sm" variant="soft" icon={record.status === 'paused' ? 'play' : 'pause'} onClick={() => togglePause(record)}>
                    {record.status === 'paused' ? 'Продолжить' : 'Пауза'}
                  </Button>
                  <Button size="sm" variant="ghost" icon="stop" onClick={() => cancel(record)}>
                    Стоп
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <div className="row-between" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16 }}>История</h2>
        <Button size="sm" variant="ghost" icon="trash" onClick={clearHistory}>
          Очистить историю
        </Button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon="clock"
          title="История пуста"
          text="Здесь появятся загрузки версий, модов и сборок."
        />
      ) : (
        <div className="download-list">
          {records.map((record) => {
            const status = STATUS[record.status] ?? STATUS.active
            const isActive = record.status === 'active' || record.status === 'paused'
            return (
              <div key={record.id} className={cx('download-row', isActive && 'is-active')}>
                <div className="download-kind">{record.kind}</div>
                <div className="grow">
                  <div className="download-title">{record.title}</div>
                  <div className="download-meta">
                    {record.error ?? record.detail ?? '—'}
                    {record.finishedAt
                      ? ` · ${new Date(record.finishedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                      : ''}
                  </div>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
