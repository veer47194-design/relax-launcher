import { useState } from 'react'
import { api, fmtPlaytime, loaderLabel, timeAgo } from '../api'
import { useApp } from '../context'
import { Badge, Button, Card, EmptyState, IconButton, PageHeader } from '../ui'
import { CreateInstanceModal } from '../components/create-instance'
import { InstanceSettingsModal } from '../components/instance-settings'

export default function Instances() {
  const { state, selectInstance, instance, running, launching, start, stop, go, openConsole } = useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const sorted = [...state.instances].sort((a, b) => {
    if (a.id === instance?.id) return -1
    if (b.id === instance?.id) return 1
    return (b.lastPlayed ?? b.created) - (a.lastPlayed ?? a.created)
  })

  const editingInstance = state.instances.find((i) => i.id === editing) ?? null

  return (
    <div>
      <PageHeader
        title="Сборки"
        subtitle="Каждая сборка — отдельные моды, настройки и сохранения"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
            Создать сборку
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon="layers"
          title="Сборок пока нет"
          text="Создайте сборку Vanilla или Fabric — лаунчер сам скачает игру и подберёт Java."
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
              Создать сборку
            </Button>
          }
        />
      ) : (
        <div className="instance-grid">
          {sorted.map((i) => {
            const isRunning = running.has(i.id)
            const isLaunching = launching === i.id
            return (
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
                      {isRunning && <Badge tone="green">В игре</Badge>}
                    </div>
                  </div>
                  <IconButton
                    icon="settings"
                    title="Настройки сборки"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(i.id)
                    }}
                  />
                </div>

                <div className="instance-meta">
                  <span>🕒 {timeAgo(i.lastPlayed)}</span>
                  <span>⏱ {fmtPlaytime(i.playtimeMs)}</span>
                  <span>🧠 {i.memoryMb ?? state.settings.memoryMb} МБ</span>
                  {i.modpack && <span>📦 {i.modpack.name}</span>}
                </div>

                <div className="instance-actions">
                  {isRunning ? (
                    <Button
                      size="sm"
                      variant="danger"
                      icon="stop"
                      onClick={(e) => {
                        e.stopPropagation()
                        stop(i.id)
                      }}
                    >
                      Остановить
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon="play"
                      loading={isLaunching}
                      onClick={(e) => {
                        e.stopPropagation()
                        selectInstance(i.id)
                        start(i.id)
                      }}
                    >
                      {isLaunching ? 'Запуск…' : 'Играть'}
                    </Button>
                  )}
                  <IconButton
                    icon="folder"
                    title="Открыть папку"
                    onClick={(e) => {
                      e.stopPropagation()
                      api.app.openPath('instance', i.id)
                    }}
                  />
                  <IconButton
                    icon="terminal"
                    title="Консоль"
                    onClick={(e) => {
                      e.stopPropagation()
                      openConsole(i.id)
                    }}
                  />
                  <IconButton
                    icon="puzzle"
                    title="Моды"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectInstance(i.id)
                      go('mods')
                    }}
                  />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <CreateInstanceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => selectInstance(created.id)}
      />
      <InstanceSettingsModal
        instance={editingInstance}
        open={!!editingInstance}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
