import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend port is set by the launcher via BACKEND_PORT env var.
// Fallback matches the launcher's preferred port (8000).
const backendPort = process.env.BACKEND_PORT || '8000'

export default defineConfig({
  plugins: [react()],
  server: {
    // Vite will use --port CLI arg if passed; this is just the fallback
    port: 5173,
    strictPort: false,   // allow Vite to pick next free port automatically
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  // When deployed under /analyzer/ path on app.fieldgovern.com
  base: process.env.VITE_BASE_PATH || '/',
})
