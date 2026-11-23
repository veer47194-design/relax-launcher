import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backgroundPath } from './background'
import { config, initConfig } from './config'
import { registerIpc } from './ipc'
import { launcher } from './launch'
import { p } from './paths'
import { resolveScreenshot } from './screenshots'
import { readZipFile } from './zip'

app.setName('Relax Launcher')
app.setAppUserModelId('com.relax.launcher')

function imageMime(name: string): string {
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.webp$/i.test(name)) return 'image/webp'
  if (/\.gif$/i.test(name)) return 'image/gif'
  return 'image/png'
}

/** Иконка окна и панели задач: своя .ico и в dev, и в собранном приложении. */
const windowIcon = (() => {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico')
  return fs.existsSync(candidate) ? candidate : undefined
})()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'relax-bg',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
  },
  {
    scheme: 'relax-shot',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
  },
  {
    scheme: 'relax-mod-icon',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
  },
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 1080,
      minHeight: 700,
      show: false,
      frame: false,
      icon: windowIcon,
      backgroundColor: '#0a0c11',
      title: 'Relax Launcher',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    })

    const sendMaximize = () => mainWindow?.webContents.send('win:maximized', !!mainWindow?.isMaximized())
    mainWindow.on('maximize', sendMaximize)
    mainWindow.on('unmaximize', sendMaximize)
    mainWindow.once('ready-to-show', () => mainWindow?.show())

    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl) {
      void mainWindow.loadURL(devUrl)
      mainWindow.webContents.on('before-input-event', (_event, input) => {
        if (input.key === 'F12') mainWindow?.webContents.toggleDevTools()
      })
    } else {
      void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    mainWindow.webContents.on('will-navigate', (event, url) => {
      const current = mainWindow?.webContents.getURL() ?? ''
      if (url !== current) {
        event.preventDefault()
        if (/^https?:/i.test(url)) void shell.openExternal(url)
      }
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    initConfig()
    registerIpc()
    protocol.handle('relax-bg', async (request) => {
      try {
        const url = new URL(request.url)
        const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
        const file = backgroundPath(name)
        if (!file) return new Response('Not found', { status: 404 })
        return net.fetch(pathToFileURL(file).toString())
      } catch {
        return new Response('Bad request', { status: 400 })
      }
    })

    protocol.handle('relax-shot', async (request) => {
      try {
        const url = new URL(request.url)
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
        if (parts.length !== 2) return new Response('Bad request', { status: 400 })
        const file = resolveScreenshot(parts[0], parts[1])
        const response = await net.fetch(pathToFileURL(file).toString())
        const buf = Buffer.from(await response.arrayBuffer())
        const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
        return new Response(bytes, {
          headers: {
            'Content-Type': response.headers.get('content-type') || imageMime(file),
            'Cache-Control': 'no-store',
          },
        })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })

    protocol.handle('relax-mod-icon', async (request) => {
      try {
        const url = new URL(request.url)
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
        if (parts.length !== 3) return new Response('Bad request', { status: 400 })
        const [instanceId, file, entry] = parts
        config().getInstance(instanceId)

        if (path.basename(file) !== file || !/(\.jar|\.zip)(\.disabled)?$/i.test(file)) {
          return new Response('Bad request', { status: 400 })
        }
        if (!entry || entry.startsWith('/') || entry.split('/').includes('..')) {
          return new Response('Bad request', { status: 400 })
        }

        const jar = path.join(p.instanceMods(instanceId), file)
        const data = readZipFile(jar, entry)
        if (!data) return new Response('Not found', { status: 404 })
        const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        return new Response(bytes, {
          headers: {
            'Content-Type': imageMime(entry),
            'Cache-Control': 'no-cache',
          },
        })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    try {
      config().flush()
    } catch {
      /* конфиг мог не успеть */
    }
  })

  process.on('uncaughtException', (error) => {
    console.error('[Relax] Необработанная ошибка:', error)
  })

  void launcher
}
