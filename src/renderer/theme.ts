import type { Settings, ThemeId } from '../shared/types'

export interface ThemeDef {
  id: ThemeId
  name: string
  note: string
  accent: string
  accent2: string
}

export const THEMES: ThemeDef[] = [
  { id: 'relax', name: 'Relax', note: 'фирменный фиолет', accent: '#7c5cff', accent2: '#38bdf8' },
  { id: 'midnight', name: 'Midnight', note: 'глубокая синева', accent: '#5b8cff', accent2: '#8b5cf6' },
  { id: 'emerald', name: 'Emerald', note: 'свежий изумруд', accent: '#34d399', accent2: '#22d3ee' },
  { id: 'sunset', name: 'Sunset', note: 'тёплый закат', accent: '#fb923c', accent2: '#f472b6' },
  { id: 'ocean', name: 'Ocean', note: 'бирюзовый бриз', accent: '#22d3ee', accent2: '#60a5fa' },
  { id: 'rose', name: 'Rose', note: 'нежная роза', accent: '#fb7185', accent2: '#c084fc' },
  { id: 'graphite', name: 'Graphite', note: 'строгий монохром', accent: '#a3adc2', accent2: '#e2e8f0' },
  { id: 'lavender', name: 'Lavender', note: 'лавандовая дымка', accent: '#a78bfa', accent2: '#f0abfc' },
  { id: 'mint', name: 'Mint', note: 'прохладная мята', accent: '#6ee7b7', accent2: '#5eead4' },
  { id: 'amber', name: 'Amber', note: 'тёплый янтарь', accent: '#fbbf24', accent2: '#fb923c' },
  { id: 'crimson', name: 'Crimson', note: 'глубокий кармин', accent: '#f87171', accent2: '#fb7185' },
  { id: 'sky', name: 'Sky', note: 'дневное небо', accent: '#38bdf8', accent2: '#818cf8' },
]

/** Готовые акценты для быстрого выбора. */
export const ACCENT_PRESETS = [
  '#7c5cff',
  '#5b8cff',
  '#38bdf8',
  '#22d3ee',
  '#34d399',
  '#a3e635',
  '#fbbf24',
  '#fb923c',
  '#f87171',
  '#fb7185',
  '#e879f9',
  '#a78bfa',
]

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const seg = Math.floor(h / 60) % 6
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg]
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

function rgbVar(hex: string): string {
  const rgb = hexToRgb(hex)
  return rgb ? `${rgb[0]} ${rgb[1]} ${rgb[2]}` : '124 92 255'
}

export function themeById(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** Применяет тему, фон и настройки движения к корню документа. */
export function applyAppearance(settings: Settings) {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.bg = settings.background
  root.dataset.image = settings.backgroundImage ? 'true' : 'false'
  root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'
  root.dataset.density = settings.uiDensity
  root.dataset.font = settings.fontFamily
  root.style.setProperty('--wallpaper-opacity', String(settings.wallpaperOpacity))
  root.style.zoom = String(settings.fontSize / 14)

  const theme = themeById(settings.theme)
  const custom = settings.accentColor ? hexToRgb(settings.accentColor) : null

  if (custom) {
    const accent = `#${settings.accentColor!.slice(1).toLowerCase()}`
    const [h, s, l] = rgbToHsl(custom[0], custom[1], custom[2])
    // Вторичный цвет — гармоничный соседний оттенок: для тёплых уходим в розовый,
    // для холодных — в фиолетовый. Так градиент остаётся дорогим, а не «светофорным».
    const secondHue = h < 90 || h >= 300 ? h - 35 : h + 35
    const second = hslToHex(secondHue, Math.min(96, s + 4), Math.min(72, l + 10))
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-rgb', rgbVar(accent))
    root.style.setProperty('--accent-2', second)
    root.style.setProperty('--accent2-rgb', rgbVar(second))
    root.style.setProperty('--accent-soft', `rgb(${rgbVar(accent)} / 0.16)`)
    root.style.setProperty('--accent-glow', `rgb(${rgbVar(accent)} / 0.45)`)
  } else {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-rgb')
    root.style.removeProperty('--accent-2')
    root.style.removeProperty('--accent2-rgb')
    root.style.removeProperty('--accent-soft')
    root.style.removeProperty('--accent-glow')
  }

  // Цвет фона подстраивается под тему, чтобы акцент смотрелся цельно.
  root.style.setProperty('--theme-accent', theme.accent)
  root.style.setProperty('--theme-accent-2', theme.accent2)
}
