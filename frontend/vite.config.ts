import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
      },
      // Manifest is also served as public/manifest.webmanifest for TWA/Bubblewrap.
      // Keep these values in sync with manifest.webmanifest and twa/twa-manifest.json.
      manifest: {
        name: 'FieldGovern',
        short_name: 'FieldGovern',
        description: 'Offline field data collection for teams',
        theme_color: '#89b4fa',
        background_color: '#11111b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity'],
        lang: 'en',
        icons: [
          { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png' },
          { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
          { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png' },
          { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
          { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          {
            name: 'Collect Data',
            short_name: 'Collect',
            url: '/collect',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
          {
            name: 'Dashboard',
            short_name: 'Dashboard',
            url: '/',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Only split true third-party vendor libraries — never application code.
          // Application chunks are created automatically by React.lazy() in App.tsx.
          // Manually grouping app modules overrides Rollup's dependency tracking and
          // produces cross-chunk circular references (TDZ "cannot access before init").
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) {
            return 'vendor-charts'
          }
        },
      },
    },
  },
  // wa-sqlite ships WASM files that Emscripten loads via import.meta.url.
  // Excluding it from pre-bundling preserves those relative URL references.
  optimizeDeps: {
    exclude: ['wa-sqlite'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
