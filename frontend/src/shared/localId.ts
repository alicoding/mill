// The one local-ID door. crypto.randomUUID exists only in secure
// contexts (https or localhost) -- a Mill server reached over plain
// http on another device (the remote instance) has no randomUUID, and
// every direct call crashed its surface there (the workflow editor was
// the observed casualty). crypto.getRandomValues works everywhere, so
// the fallback assembles the same UUIDv4 shape from it.
export function newLocalID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
