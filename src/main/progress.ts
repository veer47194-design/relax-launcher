import { BrowserWindow } from 'electron'
import { recordProgress } from './downloadLog'
import type { ProgressEvent } from '../shared/types'

export function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

const labels: Record<string, string> = {
  manifest: 'Манифест версий',
  version: 'Файлы версии',
  client: 'Клиент игры',
  libraries: 'Библиотеки',
  natives: 'Нативные библиотеки',
  assets: 'Ресурсы игры',
  logging: 'Конфигурация логирования',
  java: 'Среда Java',
  mods: 'Моды',
  modpack: 'Сборка',
  overrides: 'Файлы сборки',
  download: 'Загрузка',
  prepare: 'Подготовка',
  export: 'Экспорт',
  launch: 'Запуск',
}

export class Progress {
  private current = 0
  private total = 0
  private lastEmit = 0
  private detail: string | undefined
  private phaseKey = ''
  private finished = false

  constructor(
    public readonly id: string,
    public readonly title: string,
  ) {}

  phase(key: string, total = 0) {
    this.phaseKey = key
    this.current = 0
    this.total = total
    this.detail = undefined
    this.emit(true)
  }

  set(current: number, total: number, detail?: string) {
    this.current = current
    this.total = total
    if (detail !== undefined) this.detail = detail
    this.emit()
  }

  add(step = 1, detail?: string) {
    this.current += step
    if (detail !== undefined) this.detail = detail
    this.emit()
  }

  note(detail: string) {
    this.detail = detail
    this.emit()
  }

  private payload(): ProgressEvent {
    return {
      id: this.id,
      title: this.title,
      phase: labels[this.phaseKey] ?? this.phaseKey,
      current: this.current,
      total: this.total,
      detail: this.detail,
    }
  }

  private emit(force = false) {
    const now = Date.now()
    if (!force && now - this.lastEmit < 70) return
    this.lastEmit = now
    const payload = this.payload()
    recordProgress(payload)
    broadcast('progress', payload)
  }

  done(detail?: string) {
    if (this.finished) return
    this.finished = true
    this.current = Math.max(this.current, this.total)
    this.total = Math.max(this.total, this.current)
    const payload = { ...this.payload(), detail, done: true }
    recordProgress(payload)
    broadcast('progress', payload)
  }

  fail(error: string) {
    if (this.finished) return
    this.finished = true
    const payload = { ...this.payload(), error, done: true }
    recordProgress(payload)
    broadcast('progress', payload)
  }
}
