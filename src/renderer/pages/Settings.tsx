import { useEffect, useRef, useState } from 'react'
import type {
  BackgroundStyle,
  FontFamily,
  GcPreset,
  JavaInfo,
  Settings as SettingsType,
  ThemeId,
  UiDensity,
} from '../../shared/types'
import { api, errText, cx } from '../api'
import { useApp } from '../context'
import { THEMES, ACCENT_PRESETS, themeById } from '../theme'
import { Badge, Button, Card, Icon, PageHeader, Select, Slider, Toggle } from '../ui'

interface AppInfo {
  version: string
  root: string
  platform: string
  arch: string
  electron: string
}

const GC_PRESETS: { value: GcPreset; label: string }[] = [
  { value: 'off', label: 'Без флагов' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'aikar', label: 'Aikar' },
  { value: 'zgc', label: 'ZGC' },
]

export default function Settings() {
  const { state, setState, toast } = useApp()
  const s = state.settings
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [javaList, setJavaList] = useState<JavaInfo[]>([])
  const [runtimes, setRuntimes] = useState<{ component: string; path: string }[]>([])
  const [detecting, setDetecting] = useState(false)
  const [memory, setMemory] = useState(s.memoryMb)
  const [concurrency, setConcurrency] = useState(s.downloadConcurrency)
  const [width, setWidth] = useState(s.resolution.width)
  const [height, setHeight] = useState(s.resolution.height)
  const [jvmArgs, setJvmArgs] = useState(s.customJvmArgs)
  const [wallpaperBusy, setWallpaperBusy] = useState(false)
  const [fontSize, setFontSize] = useState(s.fontSize)
  const [wallpaperOpacity, setWallpaperOpacity] = useState(Math.round(s.wallpaperOpacity * 100))
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const pending = useRef<Partial<SettingsType>>({})
  const timer = useRef<number | null>(null)

  useEffect(() => {
    api.app.info().then(setInfo).catch(() => {})
    api.java.runtimes().then(setRuntimes).catch(() => {})
  }, [])

  useEffect(() => {
    setMemory(s.memoryMb)
    setConcurrency(s.downloadConcurrency)
    setWidth(s.resolution.width)
    setHeight(s.resolution.height)
    setJvmArgs(s.customJvmArgs)
    setFontSize(s.fontSize)
    setWallpaperOpacity(Math.round(s.wallpaperOpacity * 100))
  }, [
    s.memoryMb,
    s.downloadConcurrency,
    s.resolution.width,
    s.resolution.height,
    s.customJvmArgs,
    s.fontSize,
    s.wallpaperOpacity,
  ])

  const update = async (patch: Partial<SettingsType>) => {
    try {
      const next = await api.settings.update(patch)
      setState(next)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const queue = (patch: Partial<SettingsType>) => {
    pending.current = { ...pending.current, ...patch }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const payload = pending.current
      pending.current = {}
      void update(payload)
    }, 320)
  }

  const checkUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const info = await api.update.check(true)
      if (info.available) {
        window.dispatchEvent(new CustomEvent('relax:update-available', { detail: info }))
        toast(`Доступно обновление ${info.version}`, 'ok')
      } else if (info.error) {
        toast(info.error, 'err')
      } else {
        toast('У вас последняя версия лаунчера', 'ok')
      }
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const detectJava = async () => {    setDetecting(true)
    try {
      const list = await api.java.detect()
      setJavaList(list)
      if (list.length === 0) toast('Java не найдена. Включите автозагрузку или укажите путь вручную.', 'info')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setDetecting(false)
    }
  }

  const pickJava = async () => {
    const file = await api.app.pickFile([{ name: 'Java', extensions: ['exe'] }])
    if (file) await update({ javaPath: file })
  }

  const pickBackground = async () => {
    const file = await api.app.pickFile([
      { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] },
    ])
    if (!file) return
    setWallpaperBusy(true)
    try {
      const next = await api.settings.setBackground(file)
      setState(next)
      toast('Свой фон установлен', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setWallpaperBusy(false)
    }
  }

  const clearBackground = async () => {
    try {
      const next = await api.settings.setBackground(null)
      setState(next)
      toast('Фон сброшен', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const changeRoot = async () => {
    const dir = await api.app.pickDirectory()
    if (!dir || dir === s.rootDir) return
    await update({ rootDir: dir })
    toast('Папка данных изменена. Существующие сборки останутся в старой папке.', 'info')
  }

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Лаунчер, Java и оптимизация Minecraft" />

      <div className="settings-stack">
        <Card className="settings-card">
          <div className="settings-card-head">
            <div className="settings-icon">
              <Icon name="memory" size={18} />
            </div>
            <div>
              <h3>Производительность</h3>
              <p>Память и флаги JVM по умолчанию для новых сборок</p>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Память по умолчанию</strong>
              <span>Сколько ОЗУ выделять игре. Для модов — 4–8 ГБ.</span>
            </div>
            <div className="settings-row-control wide">
              <Slider
                value={memory}
                min={1024}
                max={32768}
                step={512}
                onChange={(v) => {
                  setMemory(v)
                  queue({ memoryMb: v })
                }}
              />
              <span className="value-pill">{memory} МБ</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Настройка сборщика мусора</strong>
              <span>
                Aikar — максимальная плавность, ZGC — современная пауза-less сборка для Java 21+.
              </span>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                {GC_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    className={cx(s.gcPreset === p.value && 'active')}
                    onClick={() => update({ gcPreset: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Свои аргументы JVM</strong>
              <span>Добавляются к каждой сборке. Например: -XX:+UseStringDeduplication</span>
            </div>
          </div>
          <textarea
            className="textarea"
            value={jvmArgs}
            placeholder="-XX:+UseStringDeduplication"
            onChange={(e) => {
              setJvmArgs(e.target.value)
              queue({ customJvmArgs: e.target.value })
            }}
          />

          <div className="info-banner">
            <Icon name="sparkles" size={17} />
            <div>
              Для максимального FPS установите набор оптимизаций во вкладке <b>Моды → Оптимизация</b>.
              Он не влияет на геймплей и легко отключается.
            </div>
          </div>
        </Card>

        <Card className="settings-card">
          <div className="settings-card-head">
            <div className="settings-icon">
              <Icon name="cpu" size={18} />
            </div>
            <div>
              <h3>Java</h3>
              <p>Лаунчер сам скачивает нужную версию Java от Mojang</p>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Автоматическая Java</strong>
              <span>Скачивать официальный рантайм под выбранную версию Minecraft</span>
            </div>
            <div className="settings-row-control">
              <Toggle checked={s.autoJava} onChange={(v) => update({ autoJava: v })} />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Своя Java</strong>
              <span>{s.javaPath ? s.javaPath : 'Не выбрана — используется автоматическая'}</span>
            </div>
            <div className="settings-row-control">
              <Button variant="soft" icon="folder" onClick={pickJava}>
                Выбрать
              </Button>
              {s.javaPath && (
                <Button variant="ghost" icon="x" onClick={() => update({ javaPath: null })}>
                  Сбросить
                </Button>
              )}
            </div>
          </div>

          <div className="row-between">
            <span className="tiny">
              Установленные рантаймы: {runtimes.length > 0 ? runtimes.map((r) => r.component).join(', ') : 'нет'}
            </span>
            <Button variant="soft" icon="search" loading={detecting} onClick={detectJava}>
              Найти Java в системе
            </Button>
          </div>

          {javaList.length > 0 && (
            <div className="java-list">
              {javaList.map((java) => (
                <div key={java.path} className="java-item">
                  <Badge tone={java.major >= 17 ? 'green' : 'amber'}>Java {java.major}</Badge>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <strong>{java.vendor || 'Java'}</strong>
                    <div>
                      <span>{java.path}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="soft" onClick={() => update({ javaPath: java.path })}>
                    Использовать
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="settings-card">
          <div className="settings-card-head">
            <div className="settings-icon">
              <Icon name="sparkles" size={18} />
            </div>
            <div>
              <h3>Внешний вид</h3>
              <p>Тема, акцент и атмосфера лаунчера</p>
            </div>
          </div>

          <div className="theme-grid">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                className={cx('theme-card', s.theme === theme.id && 'active')}
                aria-pressed={s.theme === theme.id && !s.accentColor}
                onClick={() => update({ theme: theme.id as ThemeId, accentColor: null })}
              >
                <span
                  className="theme-swatch"
                  style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})` }}
                />
                <span className="theme-info">
                  <strong>{theme.name}</strong>
                  <span>{theme.note}</span>
                </span>
                {s.theme === theme.id && !s.accentColor && (
                  <span className="theme-check">
                    <Icon name="check" size={13} />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="accent-presets">
            {ACCENT_PRESETS.map((color) => (
              <button
                key={color}
                className={cx('accent-swatch', (s.accentColor ?? '').toLowerCase() === color && 'active')}
                style={{ background: color }}
                title={color}
                aria-label={`Акцент ${color}`}
                onClick={() => update({ accentColor: color })}
              >
                {(s.accentColor ?? '').toLowerCase() === color && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Свой акцент</strong>
              <span>Любой цвет вместо готовой темы. Сбросьте, чтобы вернуть палитру темы.</span>
            </div>
            <div className="settings-row-control">
              <label className="color-picker">
                <input
                  type="color"
                  value={s.accentColor ?? themeById(s.theme).accent}
                  onChange={(e) => queue({ accentColor: e.target.value })}
                />
                <span style={{ background: s.accentColor ?? themeById(s.theme).accent }} />
                <code>{s.accentColor ?? themeById(s.theme).accent}</code>
              </label>
              {s.accentColor && (
                <Button variant="ghost" icon="x" onClick={() => update({ accentColor: null })}>
                  Сбросить
                </Button>
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Фон окна</strong>
              <span>Атмосферное свечение, сетка, волны, звёзды или строгая тёмная плоскость</span>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                {(
                  [
                    { value: 'aurora', label: 'Aurora' },
                    { value: 'mesh', label: 'Mesh' },
                    { value: 'grid', label: 'Grid' },
                    { value: 'waves', label: 'Waves' },
                    { value: 'stars', label: 'Stars' },
                    { value: 'plain', label: 'Plain' },
                  ] as { value: BackgroundStyle; label: string }[]
                ).map((bg) => (
                  <button
                    key={bg.value}
                    className={cx(s.background === bg.value && 'active')}
                    onClick={() => update({ background: bg.value })}
                  >
                    {bg.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Свои обои</strong>
              <span>
                {s.backgroundImage
                  ? 'Изображение установлено — поверх выбранного стиля фона'
                  : 'PNG, JPG, WEBP, GIF или AVIF до 40 МБ'}
              </span>
            </div>
            <div className="settings-row-control">
              {s.backgroundImage && (
                <span
                  className="wallpaper-preview"
                  style={{
                    backgroundImage: `url("relax-bg://local/${encodeURIComponent(s.backgroundImage)}")`,
                  }}
                />
              )}
              <Button variant="soft" icon="folder" loading={wallpaperBusy} onClick={pickBackground}>
                Выбрать
              </Button>
              {s.backgroundImage && (
                <Button variant="ghost" icon="x" onClick={clearBackground}>
                  Убрать
                </Button>
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Прозрачность обоев</strong>
              <span>Насколько сильно изображение видно под интерфейсом</span>
            </div>
            <div className="settings-row-control wide">
              <Slider
                value={wallpaperOpacity}
                min={8}
                max={85}
                step={1}
                onChange={(v) => {
                  setWallpaperOpacity(v)
                  queue({ wallpaperOpacity: v / 100 })
                }}
              />
              <span className="value-pill">{wallpaperOpacity}%</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Плотность интерфейса</strong>
              <span>Компактный режим уменьшает отступы и размер карточек</span>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                <button
                  className={cx(s.uiDensity === 'comfortable' && 'active')}
                  onClick={() => update({ uiDensity: 'comfortable' as UiDensity })}
                >
                  Комфортная
                </button>
                <button
                  className={cx(s.uiDensity === 'compact' && 'active')}
                  onClick={() => update({ uiDensity: 'compact' as UiDensity })}
                >
                  Компактная
                </button>
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Размер текста и элементов</strong>
              <span>Плавно масштабирует весь интерфейс лаунчера</span>
            </div>
            <div className="settings-row-control wide">
              <Slider
                value={fontSize}
                min={12}
                max={18}
                step={1}
                onChange={(v) => {
                  setFontSize(v)
                  queue({ fontSize: v })
                }}
              />
              <span className="value-pill">{fontSize} px</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Шрифт интерфейса</strong>
              <span>Можно заменить системный шрифт на моноширинный или классический</span>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                {(
                  [
                    { value: 'default', label: 'Системный' },
                    { value: 'segoe', label: 'Segoe' },
                    { value: 'mono', label: 'Моно' },
                    { value: 'serif', label: 'Serif' },
                  ] as { value: FontFamily; label: string }[]
                ).map((font) => (
                  <button
                    key={font.value}
                    className={cx(s.fontFamily === font.value && 'active')}
                    onClick={() => update({ fontFamily: font.value })}
                  >
                    {font.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Меньше анимаций</strong>
              <span>Отключить плавные переходы и свечения — для слабых ПК и спокойного интерфейса</span>
            </div>
            <div className="settings-row-control">
              <Toggle checked={s.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Автоматически проверять обновления</strong>
              <span>Тихая проверка GitHub при запуске — без навязчивых окон</span>
            </div>
            <div className="settings-row-control">
              <Toggle checked={s.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
            </div>
          </div>
        </Card>

        <Card className="settings-card">
          <div className="settings-card-head">
            <div className="settings-icon">
              <Icon name="grid" size={18} />
            </div>
            <div>
              <h3>Игра и лаунчер</h3>
              <p>Разрешение, поведение окна и консоль</p>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Размер окна игры</strong>
              <span>Ширина × высота в пикселях</span>
            </div>
            <div className="settings-row-control">
              <input
                className="input"
                type="number"
                min={320}
                max={7680}
                style={{ width: 92 }}
                value={width}
                disabled={s.resolution.fullscreen}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0
                  setWidth(v)
                  queue({ resolution: { ...s.resolution, width: v } })
                }}
              />
              <span className="muted">×</span>
              <input
                className="input"
                type="number"
                min={240}
                max={4320}
                style={{ width: 92 }}
                value={height}
                disabled={s.resolution.fullscreen}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0
                  setHeight(v)
                  queue({ resolution: { ...s.resolution, height: v } })
                }}
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Полноэкранный режим</strong>
              <span>Игра запускается на весь экран; настройку можно переопределить для отдельной сборки</span>
            </div>
            <div className="settings-row-control">
              <Toggle
                checked={s.resolution.fullscreen}
                onChange={(v) => update({ resolution: { ...s.resolution, fullscreen: v } })}
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Сворачивать лаунчер при запуске</strong>
              <span>Окно восстановится, когда игра закроется</span>
            </div>
            <div className="settings-row-control">
              <Toggle
                checked={s.closeLauncherOnStart}
                onChange={(v) => update({ closeLauncherOnStart: v })}
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Открывать консоль при запуске</strong>
              <span>Показывать логи игры и подсказки при падении</span>
            </div>
            <div className="settings-row-control">
              <Toggle checked={s.showConsole} onChange={(v) => update({ showConsole: v })} />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Параллельные загрузки</strong>
              <span>Больше — быстрее скачивание, но выше нагрузка на сеть</span>
            </div>
            <div className="settings-row-control wide">
              <Slider
                value={concurrency}
                min={4}
                max={64}
                step={4}
                onChange={(v) => {
                  setConcurrency(v)
                  queue({ downloadConcurrency: v })
                }}
              />
              <span className="value-pill">{concurrency}</span>
            </div>
          </div>
        </Card>

        <Card className="settings-card">
          <div className="settings-card-head">
            <div className="settings-icon">
              <Icon name="folder" size={18} />
            </div>
            <div>
              <h3>Папка данных</h3>
              <p>Версии, библиотеки, ресурсы и сборки</p>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <strong className="mono" style={{ fontSize: 12 }}>
                {s.rootDir}
              </strong>
              <span>
                Смена папки не переносит уже скачанные файлы. Обычно менять её не нужно.
              </span>
            </div>
            <div className="settings-row-control">
              <Button variant="soft" icon="folder" onClick={() => api.app.openPath('root')}>
                Открыть
              </Button>
              <Button variant="outline" onClick={changeRoot}>
                Изменить
              </Button>
            </div>
          </div>
        </Card>

        <Card className="settings-card">
          <div className="settings-card-head">
            <div className="settings-icon">
              <Icon name="leaf" size={18} />
            </div>
            <div>
              <h3>О лаунчере</h3>
              <p>Relax Launcher — быстрый и открытый</p>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <strong>Версия</strong>
              <span>
                {info ? `Relax Launcher ${info.version} · Electron ${info.electron} · ${info.platform}/${info.arch}` : '…'}
              </span>
            </div>
            <div className="settings-row-control">
              <Button variant="soft" icon="refresh" loading={checkingUpdate} onClick={checkUpdate}>
                Проверить обновления
              </Button>
              <Button variant="ghost" icon="terminal" onClick={() => api.app.openPath('logs')}>
                Логи
              </Button>
              <Button variant="ghost" icon="external" onClick={() => api.app.openExternal('https://modrinth.com')}>
                Modrinth
              </Button>
              <Button
                variant="ghost"
                icon="external"
                onClick={() => api.app.openExternal('https://relaxlr.github.io/')}
              >
                Наш сайт
              </Button>
              <Button
                variant="ghost"
                icon="external"
                onClick={() =>
                  api.app.openExternal('https://github.com/veer47194-design/relax-launcher')
                }
              >
                GitHub
              </Button>
            </div>
          </div>
          <div className="tiny">
            Данные игры: {info?.root ?? s.rootDir}. Моды и сборки загружаются с Modrinth, версии — с
            официальных серверов Mojang.
          </div>
        </Card>
      </div>
    </div>
  )
}
