import { useEffect, useMemo, useState } from 'react'
import type { Instance, Loader, VersionManifest } from '../../shared/types'
import { api, errText, fmtDate, loadManifest } from '../api'
import { useApp } from '../context'
import { Button, Field, Modal, SearchInput, Select, Slider, SpinnerBlock, cx } from '../ui'

const ICONS = ['🌿', '⚡', '🔥', '💎', '🌙', '🪐', '🍀', '🎮', '🧊', '🌊', '🦊', '🍉', '🐸', '🌵', '🍄', '⭐']

interface LoaderOption {
  version: string
  stable: boolean
  label?: string
}

const LOADER_SUFFIX: Record<Loader, string> = {
  vanilla: '',
  fabric: ' Fabric',
  forge: ' Forge',
}

export function CreateInstanceModal({
  open,
  onClose,
  presetVersion,
  presetLoader,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  presetVersion?: string
  presetLoader?: Loader
  onCreated?: (instance: Instance) => void
}) {
  const { state, toast, refresh } = useApp()
  const [manifest, setManifest] = useState<VersionManifest | null>(null)
  const [tab, setTab] = useState<'release' | 'snapshot'>('release')
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<Loader>('vanilla')
  const [loaders, setLoaders] = useState<LoaderOption[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [memory, setMemory] = useState(state.settings.memoryMb)
  const [icon, setIcon] = useState('🌿')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setTab('release')
    setName('')
    setLoader(presetLoader ?? 'vanilla')
    setCreating(false)
    setMemory(state.settings.memoryMb)
    setIcon(ICONS[Math.floor(Math.random() * ICONS.length)])
    setMcVersion(presetVersion || '')
    loadManifest()
      .then((m) => {
        setManifest(m)
        setMcVersion((prev) => presetVersion || prev || m.latest.release)
      })
      .catch((e) => toast(errText(e), 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetVersion, presetLoader])

  useEffect(() => {
    if (!open || loader === 'vanilla' || !mcVersion) {
      setLoaders([])
      setLoaderVersion('')
      return
    }
    let cancelled = false
    setLoaders([])
    setLoaderVersion('')
    const request =
      loader === 'forge'
        ? api.versions.forgeLoaders(mcVersion)
        : api.versions.fabricLoaders(mcVersion)
    request
      .then((list) => {
        if (cancelled) return
        const options: LoaderOption[] = list.map((l) => ({
          ...l,
          label: l.stable ? '(рекомендованная)' : '(последняя)',
        }))
        setLoaders(options)
        setLoaderVersion(options[0]?.version ?? '')
      })
      .catch((e) => {
        if (cancelled) return
        setLoaders([])
        setLoaderVersion('')
        toast(errText(e), 'err')
      })
    return () => {
      cancelled = true
    }
  }, [open, loader, mcVersion, toast])

  const versions = useMemo(() => {
    if (!manifest) return []
    const q = query.trim().toLowerCase()
    return manifest.versions
      .filter((v) => (tab === 'release' ? v.type === 'release' : v.type !== 'release'))
      .filter((v) => !q || v.id.toLowerCase().includes(q))
      .slice(0, 160)
  }, [manifest, tab, query])

  const create = async () => {
    if (!mcVersion) return
    setCreating(true)
    try {
      const finalName = name.trim() || `${mcVersion}${LOADER_SUFFIX[loader]}`
      const instance = await api.instances.create({
        name: finalName,
        mcVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion || undefined,
        memoryMb: memory,
        icon,
      })
      await refresh()
      toast(`Сборка «${instance.name}» создана`, 'ok')
      onCreated?.(instance)
      onClose()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая сборка"
      subtitle="Выберите версию игры и загрузчик — файлы скачаются при первом запуске"
      width={700}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon="plus" loading={creating} disabled={!mcVersion} onClick={create}>
            Создать сборку
          </Button>
        </>
      }
    >
      <Field label="Название" hint="Можно изменить позже">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={mcVersion ? `${mcVersion}${LOADER_SUFFIX[loader]}` : 'Моя сборка'}
          maxLength={60}
        />
      </Field>

      <div className="field">
        <div className="field-label">
          <span>Версия Minecraft</span>
          <small>Все версии загружаются напрямую с серверов Mojang</small>
        </div>
        <div className="version-picker">
          <div className="version-picker-head">
            <SearchInput value={query} onChange={setQuery} placeholder="Поиск версии…" />
            <div className="segmented">
              <button className={cx(tab === 'release' && 'active')} onClick={() => setTab('release')}>
                Релизы
              </button>
              <button className={cx(tab === 'snapshot' && 'active')} onClick={() => setTab('snapshot')}>
                Снапшоты
              </button>
            </div>
          </div>
          <div className="version-picker-list">
            {!manifest ? (
              <SpinnerBlock text="Загрузка списка версий" />
            ) : versions.length === 0 ? (
              <div className="spinner-block">Ничего не найдено</div>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  className={cx('version-option', mcVersion === v.id && 'selected')}
                  onClick={() => setMcVersion(v.id)}
                >
                  <span className="mono">{v.id}</span>
                  {v.id === manifest.latest.release && <span className="badge badge-green">последняя</span>}
                  <span className="version-option-meta">{fmtDate(v.releaseTime)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          <span>Загрузчик</span>
          <small>Fabric — для модов и оптимизации, Forge — для крупных модпаков</small>
        </div>
        <div className="segmented">
          <button className={cx(loader === 'vanilla' && 'active')} onClick={() => setLoader('vanilla')}>
            Vanilla
          </button>
          <button className={cx(loader === 'fabric' && 'active')} onClick={() => setLoader('fabric')}>
            Fabric
          </button>
          <button className={cx(loader === 'forge' && 'active')} onClick={() => setLoader('forge')}>
            Forge
          </button>
        </div>
      </div>

      {loader !== 'vanilla' && (
        <Field
          label={`Версия ${loader === 'forge' ? 'Forge' : 'Fabric'}`}
          hint="По умолчанию выбирается рекомендованная сборка"
        >
          {loaders.length === 0 ? (
            <div className="tiny">
              {loader === 'forge'
                ? 'Forge не предоставляет сборку для этой версии Minecraft — выберите другую версию.'
                : 'Fabric ещё не поддерживает эту версию — выберите другую.'}
            </div>
          ) : (
            <Select value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)}>
              {loaders.map((l) => (
                <option key={l.version} value={l.version}>
                  {l.version} {l.label ?? (l.stable ? '(стабильная)' : '')}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Field label="Память" hint="Выделяется игре. Для модов рекомендуется 4–8 ГБ">
        <div className="row">
          <Slider value={memory} min={1024} max={32768} step={512} onChange={setMemory} />
          <span className="value-pill">{memory} МБ</span>
        </div>
      </Field>

      <div className="field">
        <div className="field-label">
          <span>Иконка</span>
        </div>
        <div className="emoji-grid">
          {ICONS.map((e) => (
            <button key={e} className={cx('emoji-btn', icon === e && 'selected')} onClick={() => setIcon(e)}>
              {e}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
