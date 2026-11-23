import { createContext, useContext } from 'react'
import type { AppState, Instance, ProgressEvent } from '../shared/types'

export type Page =
  | 'home'
  | 'instances'
  | 'versions'
  | 'mods'
  | 'modpacks'
  | 'resourcepacks'
  | 'shaders'
  | 'accounts'
  | 'downloads'
  | 'settings'
  | 'screenshots'
  | 'console'
export type ToastKind = 'ok' | 'err' | 'info'
export type ModsTab = 'catalog' | 'installed' | 'resourcepacks' | 'shaders' | 'optimize'

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

export interface AppCtx {
  state: AppState
  setState: (state: AppState) => void
  refresh: () => Promise<void>
  page: Page
  go: (page: Page) => void
  selectedInstance: string | null
  selectInstance: (id: string) => void
  instance: Instance | null
  progress: ProgressEvent | null
  dismissProgress: () => void
  running: Set<string>
  launching: string | null
  start: (instanceId: string) => Promise<void>
  stop: (instanceId: string) => Promise<void>
  toast: (text: string, kind?: ToastKind) => void
  modsTab: ModsTab
  setModsTab: (tab: ModsTab) => void
  openConsole: (instanceId: string) => void
}

export const AppContext = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppContext не найден')
  return ctx
}
