import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// PWA: grava a lista de assets do build para o service worker pré-cachear e carimba a versão no sw.js.
function pwaAssets(): Plugin {
  return {
    name: 'atria-pwa-assets',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist', import.meta.url))
      // só o núcleo do app; chunks sob demanda (Mermaid, pdf.js…) entram no cache quando usados
      const assets = readdirSync(join(dist, 'assets'))
        .filter((f) => /^index-/.test(f) || /\.(css|woff2?)$/.test(f))
        .map((f) => `/assets/${f}`)
      writeFileSync(join(dist, 'sw-assets.json'), JSON.stringify(assets))
      const sw = join(dist, 'sw.js')
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', Date.now().toString(36)))
    },
  }
}

export default defineConfig({
  plugins: [react(), pwaAssets()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
      '/sandbox': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
