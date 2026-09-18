/**
 * Client-side encryption for offline survey-backup capsules.
 *
 * A completed response is encrypted with the platform's RSA **public** key and
 * saved to the respondent's device as a `.fgresp` file. Only the server (holding
 * the private key) can decrypt it — see backend `app/core/survey_crypto.py`.
 *
 * Envelope: RSA-OAEP(SHA-256) wraps a fresh AES-256-GCM key; that key encrypts the
 * JSON. Web Crypto's AES-GCM output already appends the 16-byte tag, which is the
 * exact layout the Python side expects, so the two stacks interoperate directly.
 */

export interface Capsule {
  v: number
  id: string             // == the submission local_id (used for dedup)
  token?: string         // public survey routing (public flow)
  form_id?: string       // authenticated routing (enumerator flow)
  alg: string
  ek: string   // base64 RSA-OAEP-wrapped AES key
  iv: string   // base64 12-byte nonce
  ct: string   // base64 ciphertext + tag (the encrypted payload)
}

export interface CapsuleMeta {
  id: string
  token?: string
  form_id?: string
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

/** Encrypt `payload` (the sensitive data) into a capsule. Routing fields in
 *  `meta` (id + token or form_id) stay in the envelope so the server can route
 *  before decrypting. Returns the capsule envelope object. */
export async function makeCapsule(
  publicKeyPem: string, payload: unknown, meta: CapsuleMeta,
): Promise<Capsule> {
  const pubKey = await crypto.subtle.importKey(
    'spki', pemToDer(publicKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'],
  )
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext)
  const rawAes = await crypto.subtle.exportKey('raw', aesKey)
  const ek = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, rawAes)

  return {
    v: 1, id: meta.id, token: meta.token, form_id: meta.form_id,
    alg: 'RSA-OAEP-256+A256GCM',
    ek: toB64(ek), iv: toB64(iv), ct: toB64(ct),
  }
}

/** Encrypt a single response into a downloadable `.fgresp` Blob. */
export async function encryptCapsule(
  publicKeyPem: string, payload: unknown, meta: CapsuleMeta,
): Promise<Blob> {
  const capsule = await makeCapsule(publicKeyPem, payload, meta)
  return capsuleFileBlob([capsule])
}

/** Bundle one or more capsules into a single `.fgresp` file the recover endpoints accept. */
export function capsuleFileBlob(capsules: Capsule[]): Blob {
  return new Blob([JSON.stringify({ capsules })], { type: 'application/octet-stream' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Read a .fgresp file → the capsules inside. Accepts both a bundle
 *  ({ capsules: [...] }) and a single bare capsule for forward/backward safety. */
export async function parseCapsuleFile(file: File): Promise<Capsule[]> {
  const parsed = JSON.parse(await file.text())
  if (Array.isArray(parsed?.capsules)) return parsed.capsules
  if (parsed?.ct) return [parsed]
  throw new Error('not a valid backup file')
}
