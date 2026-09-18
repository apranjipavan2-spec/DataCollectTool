/**
 * DPDP consent-withdrawal reference code: a short, human-writable code a
 * respondent can quote later ("printed slip or SMS") to have their submission
 * withdrawn/erased. Derived — not separately generated or stored — from the
 * submission's own local_id (the client-generated UUID that both the offline
 * sync path and the public-survey path already persist server-side), so it's
 * available instantly and offline, with zero new columns or round-trips.
 * The backend resolves it the same way: last 8 hex chars of local_id,
 * matched with a tenant-scoped suffix search.
 */
export function refCodeFromId(id: string): string {
  const hex = id.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  const tail = hex.slice(-8).padStart(8, '0')
  return `${tail.slice(0, 4)}-${tail.slice(4)}`
}
