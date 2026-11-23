import { useCallback, useEffect, useState } from 'react'
import type { ScreenshotInfo } from '../../shared/types'
import { api, errText, fmtBytes } from '../api'
import { useApp } from '../context'
import { Button, ConfirmButton, EmptyState, Icon, Modal, PageHeader, SpinnerBlock } from '../ui'

function shotDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export default function Screenshots() {
  const { instance, toast, go } = useApp()
  const [items, setItems] = useState<ScreenshotInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [failed, setFailed] = useState<Set<string>>(new Set())

  const load = useCallback(
    async (silent = false) => {
      if (!instance) {
        setItems([])
        return
      }
      if (!silent) setLoading(true)
      try {
        setItems(await api.screenshots.list(instance.id))
      } catch (e) {
        if (!silent) toast(errText(e), 'err')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [instance, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Скриншоты создаются игрой outside React: подтягиваем изменения сами.
  useEffect(() => {
    if (!instance) return
    const onFocus = () => void load(true)
    const timer = window.setInterval(() => void load(true), 2500)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [instance, load])

  useEffect(() => {
    setActiveFile(null)
    setFailed(new Set())
  }, [instance?.id])

  const activeIndex = activeFile ? items.findIndex((item) => item.file === activeFile) : -1
  const current = activeIndex >= 0 ? items[activeIndex] : null

  useEffect(() => {
    if (activeFile && activeIndex < 0) setActiveFile(null)
  }, [activeFile, activeIndex])

  const step = (delta: number) => {
    const next = items[activeIndex + delta]
    if (next) setActiveFile(next.file)
  }

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.file, activeIndex, items])

  const markImage = (file: string, ok: boolean) => {
    setFailed((prev) => {
      const next = new Set(prev)
      if (ok) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const remove = async (item: ScreenshotInfo) => {
    if (!instance) return
    try {
      await api.screenshots.remove(instance.id, item.file)
      toast('Скриншот удалён', 'ok')
      const next = items.filter((x) => x.file !== item.file)
      setItems(next)
      if (activeFile === item.file) {
        const neighbour = next[Math.min(activeIndex, next.length - 1)]
        setActiveFile(neighbour?.file ?? null)
      }
      markImage(item.file, true)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const openFile = async (item: ScreenshotInfo) => {
    if (!instance) return
    try {
      await api.screenshots.open(instance.id, item.file)
    } catch (e) {
      toast(`Не удалось открыть файл: ${errText(e)}`, 'err')
      void load(true)
    }
  }

  const showFolder = () => {
    if (instance) void api.app.openPath('screenshots', instance.id).catch((e) => toast(errText(e), 'err'))
  }

  if (!instance) {
    return (
      <div>
        <PageHeader title="Скриншоты" subtitle="Снимки из игры по каждой сборке" />
        <EmptyState
          icon="camera"
          title="Сначала создайте сборку"
          text="Скриншоты хранятся внутри папки сборки — выберите её, чтобы увидеть снимки."
          action={
            <Button variant="primary" icon="layers" onClick={() => go('instances')}>
              К сборкам
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Скриншоты"
        subtitle={`${instance.name} · Minecraft ${instance.mcVersion}`}
        actions={
          <div className="row">
            <Button variant="ghost" icon="folder" onClick={showFolder}>
              Папка
            </Button>
            <Button variant="soft" icon="refresh" loading={loading} onClick={() => void load()}>
              Обновить
            </Button>
          </div>
        }
      />

      {loading && items.length === 0 ? (
        <SpinnerBlock text="Чтение папки screenshots…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="camera"
          title="Скриншотов пока нет"
          text="Нажмите F2 в игре — снимок появится здесь автоматически."
          action={
            <Button variant="ghost" icon="folder" onClick={showFolder}>
              Открыть папку
            </Button>
          }
        />
      ) : (
        <>
          <div className="shot-toolbar">
            <span className="tiny">{items.length} снимков · обновляется автоматически</span>
            <span className="tiny">Клик — открыть на весь экран</span>
          </div>
          <div className="shot-grid">
            {items.map((item, index) => (
              <button
                key={item.file}
                className="shot-card"
                onClick={() => setActiveFile(item.file)}
                title={`${item.file} · ${shotDate(item.modified)}`}
              >
                {failed.has(item.file) ? (
                  <span className="shot-fallback">
                    <Icon name="camera" size={26} />
                    <span className="tiny">{item.file}</span>
                  </span>
                ) : (
                  <img
                    src={item.url}
                    alt={item.file}
                    loading="lazy"
                    draggable={false}
                    onLoad={() => markImage(item.file, true)}
                    onError={() => markImage(item.file, false)}
                  />
                )}
                <span className="shot-overlay">
                  <span className="shot-name">{item.file}</span>
                  <span className="shot-meta">{shotDate(item.modified)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <Modal
        open={!!current}
        onClose={() => setActiveFile(null)}
        title={current?.file ?? 'Скриншот'}
        subtitle={current ? `${shotDate(current.modified)} · ${fmtBytes(current.size)}` : undefined}
        width={1080}
        footer={
          current ? (
            <>
              <div className="row" style={{ marginRight: 'auto' }}>
                <Button
                  variant="ghost"
                  icon="chevronLeft"
                  disabled={activeIndex <= 0}
                  onClick={() => step(-1)}
                >
                  Предыдущий
                </Button>
                <Button
                  variant="ghost"
                  icon="chevronRight"
                  disabled={activeIndex < 0 || activeIndex >= items.length - 1}
                  onClick={() => step(1)}
                >
                  Следующий
                </Button>
              </div>
              <Button variant="ghost" icon="folder" onClick={showFolder}>
                В папке
              </Button>
              <Button variant="ghost" icon="external" onClick={() => void openFile(current)}>
                Открыть
              </Button>
              <ConfirmButton onConfirm={() => void remove(current)}>Удалить</ConfirmButton>
            </>
          ) : null
        }
      >
        {current && (
          <div className="shot-lightbox">
            {failed.has(current.file) ? (
              <span className="shot-fallback">
                <Icon name="camera" size={34} />
                <span>Не удалось прочитать изображение</span>
              </span>
            ) : (
              <img
                src={current.url}
                alt={current.file}
                draggable={false}
                onError={() => markImage(current.file, false)}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
