import { useEffect, useRef, useState } from 'react'
import type { ExitEvent, LogEvent } from '../../shared/types'
import { api, cx, errText } from '../api'
import { useApp } from '../context'
import { Badge, Button, Card, EmptyState, Icon, PageHeader, Select, Toggle } from '../ui'

export default function Console() {
  const { state, instance, selectInstance, running, start, stop, toast, go, launching } = useApp()
  const [lines, setLines] = useState<LogEvent[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [crash, setCrash] = useState<ExitEvent | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!instance) {
      setLines([])
      return
    }
    let cancelled = false
    setLines([])
    setCrash(null)
    api.logs
      .history(instance.id)
      .then((list) => !cancelled && setLines(list))
      .catch(() => {})
    const offLog = api.on.log((event) => {
      if (event.instanceId !== instance.id) return
      setLines((prev) => [...prev.slice(-2999), event])
    })
    const offExit = api.on.exit((event) => {
      if (event.instanceId !== instance.id) return
      if (event.code === 0) setCrash(null)
      else setCrash(event)
    })
    return () => {
      cancelled = true
      offLog()
      offExit()
    }
  }, [instance?.id])

  useEffect(() => {
    if (autoScroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  if (!instance) {
    return (
      <div>
        <PageHeader title="Консоль" subtitle="Логи игры и подсказки при ошибках" />
        <EmptyState
          icon="terminal"
          title="Нет выбранной сборки"
          text="Создайте сборку, чтобы видеть логи запуска и диагностику падений."
          action={
            <Button variant="primary" icon="plus" onClick={() => go('instances')}>
              К сборкам
            </Button>
          }
        />
      </div>
    )
  }

  const isRunning = running.has(instance.id)
  const isLaunching = launching === instance.id

  const copy = async () => {
    await api.app.clipboard(lines.map((l) => l.line).join('\n'))
    toast('Логи скопированы', 'ok')
  }

  const analyzeAgain = async () => {
    try {
      const result = await api.diagnostics.crash(instance.id)
      setCrash({
        instanceId: instance.id,
        code: result.reason ? -1 : 0,
        durationMs: 0,
        hints: result.hints,
        crashedAt: result.crashedAt,
        reason: result.reason,
        suspects: result.suspects,
        reportFile: result.reportFile,
      })
      if (result.hints.length === 0) toast('Краш-репорт не найден — анализ логов ничего не выявил', 'info')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const copyDiagnosis = async () => {
    if (!crash) return
    const parts = [
      `Краш Minecraft ${instance.name} · ${new Date(crash.crashedAt ?? Date.now()).toLocaleString('ru-RU')}`,
      crash.reason ? `Причина: ${crash.reason}` : '',
      crash.suspects?.length ? `Подозреваемые моды: ${crash.suspects.join(', ')}` : '',
      crash.reportFile ? `Отчёт: ${crash.reportFile}` : '',
      ...crash.hints.map((h) => `• ${h}`),
    ].filter(Boolean)
    await api.app.clipboard(parts.join('\n'))
    toast('Диагноз скопирован', 'ok')
  }

  return (
    <div>
      <PageHeader
        title="Консоль"
        subtitle={`${instance.name} · Minecraft ${instance.mcVersion}`}
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
            {isRunning ? (
              <Button variant="danger" icon="stop" onClick={() => stop(instance.id)}>
                Остановить
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="play"
                loading={isLaunching}
                onClick={() => start(instance.id)}
              >
                Запустить
              </Button>
            )}
          </>
        }
      />

      <div className="console-toolbar">
        {isRunning ? <Badge tone="green">Игра запущена</Badge> : <Badge>Не запущена</Badge>}
        <span className="tiny">{lines.length} строк</span>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <span className="tiny">Автопрокрутка</span>
          <Toggle checked={autoScroll} onChange={setAutoScroll} />
          <Button size="sm" variant="ghost" icon="copy" onClick={copy} disabled={lines.length === 0}>
            Копировать
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setLines([])}>
            Очистить
          </Button>
          <Button size="sm" variant="ghost" icon="folder" onClick={() => api.app.openPath('logs')}>
            Логи
          </Button>
          <Button size="sm" variant="ghost" icon="search" onClick={analyzeAgain}>
            Анализ краша
          </Button>
        </div>
      </div>

      {crash && (
        <Card className="crash-card">
          <div className="crash-head">
            <Icon name="alert" size={18} />
            <div className="grow">
              <strong>Произошёл краш Minecraft</strong>
              <span className="tiny">
                {new Date(crash.crashedAt ?? Date.now()).toLocaleString('ru-RU')} · код выхода {crash.code ?? '—'}
                {crash.reportFile ? ` · ${crash.reportFile}` : ''}
              </span>
            </div>
            <Badge tone="red">Краш</Badge>
          </div>

          {crash.reason && (
            <div className="crash-reason">
              <span className="tiny">Причина</span>
              <div>{crash.reason}</div>
            </div>
          )}

          {crash.suspects && crash.suspects.length > 0 && (
            <div className="crash-suspects">
              <span className="tiny">Подозреваемые моды</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {crash.suspects.map((mod) => (
                  <Badge key={mod} tone="amber">
                    {mod}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button size="sm" variant="soft" icon="folder" onClick={() => api.app.openPath('crashes', instance.id)}>
              Папка крашей
            </Button>
            <Button size="sm" variant="ghost" icon="copy" onClick={copyDiagnosis}>
              Скопировать диагноз
            </Button>
          </div>
        </Card>
      )}

      {crash && crash.hints.length > 0 && (
        <div className="console-hints">
          {crash.hints.map((hint) => (
            <div key={hint} className="hint-item">
              <Icon name="alert" size={16} />
              <span>{hint}</span>
            </div>
          ))}
        </div>
      )}

      <div className="console" ref={boxRef}>
        {lines.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            Консоль пуста. Запустите игру — здесь появится вывод Java, логи загрузки модов и
            подсказки при ошибках.
          </div>
        ) : (
          lines.map((line, index) => (
            <div key={`${line.at}-${index}`} className={cx('log-line', line.stream)}>
              <span className="log-time">
                {new Date(line.at).toLocaleTimeString('ru-RU', { hour12: false })}
              </span>
              {line.line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
