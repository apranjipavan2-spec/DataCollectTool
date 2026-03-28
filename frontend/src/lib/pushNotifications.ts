/**
 * Web Push Notification helpers.
 *
 * Call `subscribeToPush()` after login to register the browser for push
 * notifications. The VAPID public key must be set in the environment as
 * VITE_VAPID_PUBLIC_KEY.
 */
import api from '@/lib/api'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/**
 * Convert a URL-safe base64 string to a Uint8Array (for applicationServerKey).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Request notification permission and subscribe the browser to push.
 * Sends the subscription to the backend so the server can push later.
 *
 * Safe to call multiple times — it's a no-op if already subscribed or
 * if VAPID key is missing.
 */
export async function subscribeToPush(): Promise<boolean> {
  try {
    // Guard: need VAPID key, service worker support, and notification API
    if (!VAPID_PUBLIC_KEY) {
      console.warn('[Push] VITE_VAPID_PUBLIC_KEY not set — skipping push subscription')
      return false
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Push notifications not supported in this browser')
      return false
    }

    // Request permission
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      console.info('[Push] Notification permission denied')
      return false
    }

    // Get the active service worker registration
    const registration = await navigator.serviceWorker.ready

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      // Subscribe with the VAPID application server key
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      })
    }

    // Send subscription to backend
    const sub = subscription.toJSON()
    await api.post('/notifications/subscribe', {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.keys?.p256dh,
        auth: sub.keys?.auth,
      },
    })

    console.info('[Push] Successfully subscribed to push notifications')
    return true
  } catch (err) {
    console.error('[Push] Failed to subscribe:', err)
    return false
  }
}

/**
 * Unsubscribe from push notifications and remove from backend.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()

    if (subscription) {
      const sub = subscription.toJSON()

      // Remove from backend
      await api.post('/notifications/unsubscribe', {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys?.p256dh,
          auth: sub.keys?.auth,
        },
      })

      // Unsubscribe locally
      await subscription.unsubscribe()
    }

    console.info('[Push] Unsubscribed from push notifications')
    return true
  } catch (err) {
    console.error('[Push] Failed to unsubscribe:', err)
    return false
  }
}
