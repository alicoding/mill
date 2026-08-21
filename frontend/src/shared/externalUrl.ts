// normalizeExternalURL makes a user-entered location openable: a value
// without a scheme (the way people actually type URLs) gets https://.
// Anything already carrying a scheme passes through untouched.
export function normalizeExternalURL(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '' || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}
