import { app } from 'electron'
import path from 'node:path'

let rootDir = ''

export function setRoot(dir: string) {
  rootDir = dir
}

export function root(): string {
  if (!rootDir) throw new Error('Корневая папка ещё не инициализирована')
  return rootDir
}

export const configDir = () => app.getPath('userData')

export const p = {
  root,
  versions: () => path.join(root(), 'versions'),
  version: (id: string) => path.join(root(), 'versions', id),
  libraries: () => path.join(root(), 'libraries'),
  assets: () => path.join(root(), 'assets'),
  indexes: () => path.join(root(), 'assets', 'indexes'),
  objects: () => path.join(root(), 'assets', 'objects'),
  virtualAssets: (id: string) => path.join(root(), 'assets', 'virtual', id),
  runtime: () => path.join(root(), 'runtime'),
  instances: () => path.join(root(), 'instances'),
  instance: (id: string) => path.join(root(), 'instances', id),
  instanceMods: (id: string) => path.join(root(), 'instances', id, 'mods'),
  cache: () => path.join(root(), 'cache'),
  logs: () => path.join(root(), 'logs'),
  configFile: () => path.join(configDir(), 'config.json'),
  runtimeManifest: () => path.join(root(), 'cache', 'java-runtimes.json'),
}
