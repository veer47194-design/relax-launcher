import { createServer } from 'vite'
import * as esbuild from 'esbuild'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const server = await createServer({ server: { port: 5273, strictPort: true } })
await server.listen()
server.printUrls()

const devUrl = `http://localhost:${server.config.server.port}`
process.env.VITE_DEV_SERVER_URL = devUrl

let child = null
let building = false

function startElectron() {
  if (child) {
    try {
      child.kill()
    } catch {}
  }
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl, ELECTRON_ENABLE_LOGGING: '1' },
  })
  child.on('exit', (code) => {
    if (code !== null && code !== 0 && !building) {
      console.log(`[electron] завершился с кодом ${code}`)
    }
  })
}

const restartPlugin = {
  name: 'restart-electron',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        building = false
        console.log('[main] пересобран')
        startElectron()
      }
    })
  },
}

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
}

const mainCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
  plugins: [restartPlugin],
})
const preloadCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.js',
})

await preloadCtx.watch()
await mainCtx.watch()

const shutdown = async () => {
  try {
    child?.kill()
  } catch {}
  await mainCtx.dispose()
  await preloadCtx.dispose()
  await server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
