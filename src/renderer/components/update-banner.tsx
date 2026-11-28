import { useEffect, useState } from 'react'
import type { UpdateInfo, UpdateProgress } from '../../shared/types'
import { api, errText } from '../api'
import { useApp } from '../context'
import { Icon, ProgressBar } from '../ui'

/**
 * Баннер автообновления: проверяет GitHub Releases при старте,
 * качает установщик с прогрессом и перезапускает лаунчер.
 */
export function UpdateBanner() {
  const { state, toast } = useApp()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [platform, setPlatform] = useState('win32')

  useEffect(() => {
    api.app
      .info()
      .then((i) => setPlatform(i.platform))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const off = api.update.onProgress((event) => {
      setProgress(event)
      if (event.phase === 'ready') {
        setBusy(false)
        toast(`Обновление ${event.version ?? ''} скачано`, 'ok')
      } else if (event.phase === 'error') {
        setBusy(false)
        toast(event.error ?? 'Не удалось скачать обновление', 'err')
      }
    })
    return off
  }, [toast])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<UpdateInfo>).detail
      if (detail?.available) {
        setInfo(detail)
        setDismissed(false)
      }
    }
    window.addEventListener('relax:update-available', handler)
    return () => window.removeEventListener('relax:update-available', handler)
  }, [])

  useEffect(() => {
    if (!state.settings.autoUpdate) return
    let alive = true
    api.update
      .check()
      .then((next) => {
        if (alive && next.available) setInfo(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [state.settings.autoUpdate])

  if (dismissed) return null
  const ready = progress?.phase === 'ready'
  if (!info?.available && !ready) return null

  const version = info?.version ?? progress?.version ?? ''
  const sizeMb = info?.size ? `${(info.size / 1024 / 1024).toFixed(1)} МБ` : ''

  const download = async () => {
    setBusy(true)
    try {
      await api.update.download()
    } catch (e) {
      setBusy(false)
      toast(errText(e), 'err')
    }
  }

  const install = async () => {
    try {
      toast('Лаунчер закроется и запустит установщик', 'info')
      await api.update.install()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  /** Один клик: скачать установщик и сразу запустить обновление. */
  const update = async () => {
    setBusy(true)
    try {
      await api.update.download()
      toast('Лаунчер закроется и запустит установщик', 'info')
      await api.update.install()
    } catch (e) {
      setBusy(false)
      toast(errText(e), 'err')
    }
  }

  return (
    <div className="update-banner">
      <div className="update-banner-head">
        <span className="update-badge">
          <Icon name={ready ? 'check' : 'download'} size={14} />
        </span>
        <div className="grow">
          <strong>{ready ? 'Обновление готово' : `Доступно обновление ${version}`}</strong>
          <span>
            {platform !== 'win32'
              ? `Сейчас установлена ${info?.current ?? ''} · пакет .deb на странице релиза`
              : ready
                ? 'Перезапустите лаунчер, чтобы установить новую версию'
                : `Сейчас установлена ${info?.current}${sizeMb ? ` · ${sizeMb}` : ''}`}
          </span>
        </div>
        <button className="icon-btn" onClick={() => setDismissed(true)} aria-label="Скрыть">
          <Icon name="x" size={13} />
        </button>
      </div>

      {busy && progress && progress.phase === 'download' && (
        <>
          <ProgressBar value={progress.received} max={progress.total || 1} />
          <div className="update-banner-meta">
            <span>Скачивание…</span>
            <span>{progress.percent}%</span>
          </div>
        </>
      )}

      <div className="update-banner-actions">
        {platform !== 'win32' ? (
          <button className="btn btn-primary btn-sm" onClick={() => api.update.openRelease()}>
            <Icon name="download" size={13} />
            Скачать .deb
          </button>
        ) : ready ? (
          <button className="btn btn-primary btn-sm" onClick={install}>
            <Icon name="refresh" size={13} />
            Перезапустить и установить
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={update} disabled={busy}>
            <Icon name="refresh" size={13} />
            {busy ? 'Скачивание…' : 'Обновить'}
          </button>
        )}
        {platform === 'win32' && !ready && (
          <button className="btn btn-ghost btn-sm" onClick={download} disabled={busy}>
            Только скачать
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => api.update.openRelease()}>
          Что нового
        </button>
      </div>
    </div>
  )
}
