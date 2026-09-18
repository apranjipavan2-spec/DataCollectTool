import { useState } from 'react'
import axios from 'axios'
import EmojiIcon from '@/components/EmojiIcon'
import { parseCapsuleFile, type Capsule } from './surveyCrypto'

interface Result { name: string; status: 'saved' | 'duplicate' | 'error'; detail?: string }

/**
 * Public recovery page — upload encrypted `.fgresp` backup files saved on a device
 * when a survey response couldn't reach the server. The server decrypts them (only
 * it holds the private key) and stores them as normal submissions; re-uploading the
 * same file is deduped, so it's always safe to try again.
 */
export default function RecoverPage() {
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setResults([])

    const capsules: Capsule[] = []
    const names: string[] = []
    const parseErrors: Result[] = []
    for (const file of Array.from(files)) {
      try {
        const parsed = await parseCapsuleFile(file)
        for (const c of parsed) { capsules.push(c); names.push(file.name) }
      } catch {
        parseErrors.push({ name: file.name, status: 'error', detail: 'not a valid backup file' })
      }
    }

    const out: Result[] = [...parseErrors]
    if (capsules.length) {
      try {
        const { data } = await axios.post('/api/v1/survey/recover', { capsules }, { timeout: 60000 })
        for (const r of data.results as { index: number; status: Result['status']; detail?: string }[]) {
          out.push({ name: names[r.index] ?? `file ${r.index + 1}`, status: r.status, detail: r.detail })
        }
      } catch (err: any) {
        const detail = err?.response?.data?.detail ?? 'upload failed — check your connection'
        for (const n of names) out.push({ name: n, status: 'error', detail })
      }
    }
    setResults(out)
    setBusy(false)
  }

  const saved = results.filter(r => r.status === 'saved').length
  const dupes = results.filter(r => r.status === 'duplicate').length

  return (
    <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-catalan-surface border border-catalan-border rounded-2xl p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3"><EmojiIcon e="🛟" /></div>
          <h1 className="text-xl font-bold text-catalan-text mb-1">Recover saved responses</h1>
          <p className="text-sm text-catalan-textMuted">
            Upload the <code className="text-catalan-primary">.fgresp</code> backup file(s) saved on your
            device. Your answers are encrypted — only our server can read them.
          </p>
        </div>

        <label className={`block w-full text-center border-2 border-dashed border-catalan-primary/40 rounded-xl py-8 px-4 cursor-pointer hover:bg-catalan-primary/5 transition-colors ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
          <input type="file" accept=".fgresp,application/octet-stream" multiple className="hidden"
            onChange={e => onFiles(e.target.files)} />
          <div className="text-3xl mb-2"><EmojiIcon e="📤" /></div>
          <div className="text-sm font-medium text-catalan-text">
            {busy ? 'Uploading…' : 'Tap to choose backup file(s)'}
          </div>
        </label>

        {results.length > 0 && (
          <div className="mt-6 space-y-2">
            {(saved > 0 || dupes > 0) && (
              <p className="text-sm text-catalan-text font-medium">
                {saved > 0 && <span className="text-catalan-success">{saved} uploaded</span>}
                {saved > 0 && dupes > 0 && ' · '}
                {dupes > 0 && <span className="text-catalan-textMuted">{dupes} already had it</span>}
              </p>
            )}
            <ul className="text-xs space-y-1">
              {results.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span>{r.status === 'error' ? '⚠️' : r.status === 'saved' ? '✅' : '↺'}</span>
                  <span className="text-catalan-textMuted break-all">
                    <span className="text-catalan-text">{r.name}</span>
                    {r.status === 'saved' && ' — uploaded'}
                    {r.status === 'duplicate' && ' — already uploaded'}
                    {r.status === 'error' && ` — ${r.detail}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
