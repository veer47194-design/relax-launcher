import { build as esbuild } from 'esbuild'
import { build as viteBuild } from 'vite'

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  minify: true,
  sourcemap: false,
  logLevel: 'info',
}

await Promise.all([
  esbuild({ ...shared, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' }),
  esbuild({ ...shared, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' }),
])

await viteBuild()
console.log('\nГотово: dist/')
