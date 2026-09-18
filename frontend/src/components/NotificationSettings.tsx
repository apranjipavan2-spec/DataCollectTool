import { useState, useEffect } from 'react'
import { subscribeToPush, unsubscribeFromPush } from '@/lib/pushNotifications'
import { Button } from '@/components/ui'
import EmojiIcon from '@/components/EmojiIcon'

type PermState = 'default' | 'granted' | 'denied' | 'unsupported'

export default function NotificationSettings() {
  const [permState, setPermState] = useState<PermState>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const hasVapidKey = !!import.meta.env.VITE_VAPID_PUBLIC_KEY

  useEffect(() => {
    checkState()
  }, [])

  async function checkState() {
    // Check browser support
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPermState('unsupported')
      return
    }

    // Check permission
    setPermState(Notification.permission as PermState)

    // Check existing subscription
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setSubscribed(!!sub)
    } catch {
      // ignore
    }
  }

  const handleEnable = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const ok = await subscribeToPush()
      if (ok) {
        setSubscribed(true)
        setPermState('granted')
        setStatus({ type: 'success', msg: 'Notifications enabled! You\'ll receive alerts for form assignments and updates.' })
      } else {
        // Could be denied or missing key
        setPermState(Notification.permission as PermState)
        if (Notification.permission === 'denied') {
          setStatus({ type: 'error', msg: 'Permission denied. Please allow notifications in your browser settings.' })
        } else if (!hasVapidKey) {
          setStatus({ type: 'error', msg: 'Push notifications are not configured on this server.' })
        } else {
          setStatus({ type: 'error', msg: 'Failed to enable notifications. Please try again.' })
        }
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Failed to enable notifications.' })
    } finally {
      setLoading(false)
    }
  }

  const handleDisable = async () => {
    setLoading(true)
    setStatus(null)
    try {
      await unsubscribeFromPush()
      setSubscribed(false)
      setStatus({ type: 'success', msg: 'Notifications disabled.' })
    } catch {
      setStatus({ type: 'error', msg: 'Failed to disable notifications.' })
    } finally {
      setLoading(false)
    }
  }

  const handleTest = async () => {
    if (!('Notification' in window)) return
    new Notification('FieldGovern Test', {
      body: 'Notifications are working correctly!',
      icon: '/icons/icon-192x192.png',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-catalan-primary/10 flex items-center justify-center text-lg">
          <EmojiIcon e="🔔" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-catalan-text">Push Notifications</h3>
          <p className="text-xs text-catalan-textMuted">
            Get notified when forms are assigned, submissions are flagged, or updates are available.
          </p>
        </div>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          permState === 'unsupported' ? 'bg-catalan-textMuted' :
          subscribed ? 'bg-catalan-success' :
          permState === 'denied' ? 'bg-catalan-error' :
          'bg-catalan-warning'
        }`} />
        <span className="text-xs text-catalan-textMuted">
          {permState === 'unsupported' ? 'Not supported in this browser' :
           subscribed ? 'Enabled — receiving notifications' :
           permState === 'denied' ? 'Blocked — update browser settings to allow' :
           'Not enabled'}
        </span>
      </div>

      {/* Actions */}
      {permState !== 'unsupported' && (
        <div className="flex gap-2 flex-wrap">
          {!subscribed ? (
            <Button
              size="sm"
              onClick={handleEnable}
              disabled={loading || permState === 'denied'}
            >
              {loading ? 'Enabling…' : 'Enable Notifications'}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTest}
              >
                Send Test
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDisable}
                disabled={loading}
                className="!text-catalan-error hover:!bg-catalan-error/10"
              >
                {loading ? 'Disabling…' : 'Disable'}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Blocked help */}
      {permState === 'denied' && (
        <div className="text-xs text-catalan-textMuted bg-catalan-bg rounded-lg border border-catalan-border p-3">
          <p className="font-medium text-catalan-text mb-1">How to unblock notifications:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Click the lock/info icon in the address bar</li>
            <li>Find "Notifications" and change to "Allow"</li>
            <li>Reload this page</li>
          </ol>
        </div>
      )}

      {/* Status message */}
      {status && (
        <div className={`text-xs rounded-lg px-3 py-2 ${
          status.type === 'success'
            ? 'text-catalan-success bg-catalan-success/10 border border-catalan-success/30'
            : 'text-catalan-error bg-catalan-error/10 border border-catalan-error/30'
        }`}>
          {status.msg}
        </div>
      )}
    </div>
  )
}
