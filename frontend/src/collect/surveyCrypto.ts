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
  id: string
  token: string
  alg: string
  ek: string   // base64 RSA-OAEP-wrapped AES key
  iv: string   // base64 12-byte nonce
  ct: string   // base64 ciphertext + tag
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

export async function encryptCapsule(
  token: string, publicKeyPem: string, dataJson: unknown, id: string,
): Promise<Blob> {
  const pubKey = await crypto.subtle.importKey(
    'spki', pemToDer(publicKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'],
  )
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(dataJson))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext)
  const rawAes = await crypto.subtle.exportKey('raw', aesKey)
  const ek = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, rawAes)

  const capsule: Capsule = {
    v: 1, id, token, alg: 'RSA-OAEP-256+A256GCM',
    ek: toB64(ek), iv: toB64(iv), ct: toB64(ct),
  }
  return new Blob([JSON.stringify(capsule)], { type: 'application/octet-stream' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function parseCapsuleFile(file: File): Promise<Capsule> {
  return JSON.parse(await file.text())
}
