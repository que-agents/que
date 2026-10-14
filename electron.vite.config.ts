import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@daemon': resolve(__dirname, 'src/daemon'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

// Dependencies are externalized for main and preload by default (electron-vite 5).
export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': alias['@shared'], '@renderer': alias['@renderer'] } },
    plugins: [react()]
  }
})
