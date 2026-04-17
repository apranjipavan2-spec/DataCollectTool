// @ts-nocheck
/**
 * FieldPulse Service Worker
 *
 * Built with Workbox (injected by vite-plugin-pwa injectManifest strategy).
 * Handles:
 *   - Precaching of app shell (injected at build time)
 *   - Background Sync ('sync-submissions') — wakes up even when app is closed,
 *     messages an open client to perform the actual sync with stored credentials
 */

/// <reference lib="WebWorker" />
/// <reference types="vite-plugin-pwa/info" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// ── Precache app shell (populated by vite-plugin-pwa at build time) ──────────
precacheAndRoute(self.__WB_MANIFEST)

// ── Map tile caching (cache-first, max 2000 tiles, 30-day TTL) ───────────────
registerRoute(
  ({ url }) => url.hostname === 'tile.openstreetmap.org',
  new CacheFirst({
    cacheName: 'fieldpulse-map-tiles-v1',
    plugins: [
      new ExpirationPlugin({ maxEntries: 2000, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
)

// ── Background Sync ───────────────────────────────────────────────────────────
// When the device regains network the browser fires a 'sync' event even if
// the app tab is closed. We find an open client and ask it to sync; if none
// are open we post a message that will be picked up when the app next opens.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-submissions') {
    event.waitUntil(triggerClientSync())
  }
})

async function triggerClientSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clients.length > 0) {
    clients[0].postMessage({ type: 'TRIGGER_SYNC' })
  }
  // If no clients open, app syncs on next open (sync-on-open in FieldApp.tsx)
}

// ── Web Push Notifications ────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'FieldPulse', body: event.data.text() }
  }

  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    data: { url: payload.url || '/' },
    vibrate: [200, 100, 200],
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'FieldPulse', options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if one is open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(url)
    })
  )
})

// ── Messages from app ─────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNC_COMPLETE') {
    // App confirmed sync — no action needed in SW
  }
})
