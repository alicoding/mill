// Whether a recorded step payload is worth a JSON view (docs/goals/0058
// item 4's Text/JSON toggle) -- only an object or array root qualifies:
// a bare string/number/bool parses as valid JSON too, but a second
// "JSON view" of it shows nothing a plain text view didn't already.
export function isJsonLike(payload: string): boolean {
  const trimmed = payload.trim()
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

// Pretty-prints a payload already confirmed JSON-like -- falls back to
// the raw string on a parse failure so a toggle can never blank the
// pane it's meant to reformat.
export function formatJson(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}
