import { useEffect, useState } from 'react'
import type { GcPreset, Instance } from '../../shared/types'
import { api, errText, fmtBytes, loaderLabel } from '../api'
import { useApp } from '../context'
import { Button, ConfirmButton, Field, Modal, Select, Slider, Toggle, cx } from '../ui'

export function InstanceSettingsModal({
  instance,
  open,
  onClose,
}: {
  instance: Instance | null
  open: boolean
  onClose: () => void
}) {
  const { state, toast, refresh, go } = useApp()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🌿')
  const [memory, setMemory] = useState(4096)
  const [preset, setPreset] = useState<GcPreset | ''>('')
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(720)
  const [fullscreen, setFullscreen] = useState(false)
  const [includeSaves, setIncludeSaves] = useState(false)
  const [javaPath, setJavaPath] = useState('')
  const [size, setSize] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!open || !instance) return
    setName(instance.name)
    setIcon(instance.icon)
    setMemory(instance.memoryMb ?? state.settings.memoryMb)
    setPreset(instance.gcPreset ?? '')
    const res = instance.resolution ?? state.settings.resolution
    setWidth(res.width)
    setHeight(res.height)
    setFullscreen(res.fullscreen)
    setIncludeSaves(false)
    setJavaPath(instance.javaPath ?? '')
    setSize(null)
    api.instances
      .size(instance.id)
      .then(setSize)
      .catch(() => setSize(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance?.id])

  if (!instance) return null

  const save = async () => {
    setSaving(true)
    try {
      await api.instances.update(instance.id, {
        name: name.trim() || instance.name,
        icon,
        memoryMb: memory,
        gcPreset: preset === '' ? undefined : preset,
        resolution: { width, height, fullscreen },
        javaPath: javaPath.trim() || null,
      })
      await refresh()
      toast('Настройки сборки сохранены', 'ok')
      onClose()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await api.instances.remove(instance.id)
      await refresh()
      toast('Сборка удалена', 'ok')
      onClose()
      go('instances')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const duplicate = async () => {
    try {
      await api.instances.duplicate(instance.id)
      await refresh()
      toast('Создана копия сборки', 'ok')
      onClose()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const pickJava = async () => {
    const file = await api.app.pickFile([{ name: 'Java', extensions: ['exe'] }])
    if (file) setJavaPath(file)
  }

  const exportZip = async () => {
    setExporting(true)
    try {
      const result = await api.instances.export(instance.id, { includeSaves })
      if (result.cancelled) return
      toast(
        `Экспортировано ${result.files ?? 0} файлов · ${fmtBytes(result.bytes ?? 0)}`,
        'ok',
      )
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={instance.name}
      subtitle={`Minecraft ${instance.mcVersion} · ${loaderLabel(instance.loader, instance.loaderVersion)}`}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon="check" loading={saving} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <Field label="Название">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>

      <div className="field">
        <div className="field-label">
          <span>Иконка</span>
        </div>
        <div className="emoji-grid">
          {['🌿', '⚡', '🔥', '💎', '🌙', '🪐', '🍀', '🎮', '🧊', '🌊', '🦊', '🍉', '🐸', '🌵', '🍄', '⭐'].map((e) => (
            <button key={e} className={cx('emoji-btn', icon === e && 'selected')} onClick={() => setIcon(e)}>
              {e}
            </button>
          ))}
        </div>
      </div>

      <Field label="Память" hint="Для тяжёлых сборок с модами рекомендуется 6–8 ГБ">
        <div className="row">
          <Slider value={memory} min={1024} max={32768} step={512} onChange={setMemory} />
          <span className="value-pill">{memory} МБ</span>
        </div>
      </Field>

      <Field label="Оптимизация JVM" hint="Aikar — максимум FPS, ZGC — для Java 21+">
        <Select value={preset} onChange={(e) => setPreset(e.target.value as GcPreset | '')}>
          <option value="">Как в настройках лаунчера</option>
          <option value="off">Без флагов</option>
          <option value="balanced">Сбалансированный (G1GC)</option>
          <option value="aikar">Aikar (максимум FPS)</option>
          <option value="zgc">ZGC (Java 21+)</option>
        </Select>
      </Field>

      <Field label="Размер окна" hint="Ширина × высота в пикселях">
        <div className="row">
          <input
            className="input"
            type="number"
            min={320}
            max={7680}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value) || 0)}
            disabled={fullscreen}
          />
          <span className="muted">×</span>
          <input
            className="input"
            type="number"
            min={240}
            max={4320}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value) || 0)}
            disabled={fullscreen}
          />
        </div>
      </Field>

      <Field label="Полноэкранный режим" hint="Размер окна не используется, игра занимает весь экран">
        <div className="row-between">
          <span className="tiny">{fullscreen ? 'Включён' : 'Оконный режим'}</span>
          <Toggle checked={fullscreen} onChange={setFullscreen} />
        </div>
      </Field>

      <Field label="Java" hint="Оставьте пустым — лаунчер подберёт и скачает нужную версию сам">
        <div className="row">
          <input
            className="input"
            value={javaPath}
            placeholder="Автоматически"
            onChange={(e) => setJavaPath(e.target.value)}
          />
          <Button variant="soft" onClick={pickJava}>
            Обзор
          </Button>
          {javaPath && (
            <Button variant="ghost" icon="x" onClick={() => setJavaPath('')} title="Сбросить">
              {''}
            </Button>
          )}
        </div>
      </Field>

      {instance.modpack && (
        <div className="info-banner">
          <span>
            Сборка Modrinth: <strong>{instance.modpack.name}</strong>
          </span>
        </div>
      )}

      <div className="export-block">
        <div className="export-info">
          <strong>Экспорт сборки</strong>
          <span>
            Моды, конфиги, ресурс-паки, шейдеры и <code>options.txt</code> в одном ZIP-архиве.
            {includeSaves ? ' Сохранения будут включены.' : ' Миры можно добавить отдельно.'}
          </span>
        </div>
        <div className="export-actions">
          <label className="export-check">
            <Toggle checked={includeSaves} onChange={setIncludeSaves} />
            <span>С сохранениями</span>
          </label>
          <Button variant="soft" icon="download" loading={exporting} onClick={exportZip}>
            Экспорт .zip
          </Button>
        </div>
      </div>

      <div className="row-between">
        <div className="tiny">
          {size != null ? `Файлы сборки: ${fmtBytes(size)}` : 'Подсчёт размера…'} · {instance.id}
        </div>
        <div className="row">
          <Button variant="ghost" icon="folder" onClick={() => api.app.openPath('instance', instance.id)}>
            Папка
          </Button>
          <Button variant="ghost" icon="copy" onClick={duplicate}>
            Дублировать
          </Button>
          <ConfirmButton onConfirm={remove}>Удалить</ConfirmButton>
        </div>
      </div>
    </Modal>
  )
}
