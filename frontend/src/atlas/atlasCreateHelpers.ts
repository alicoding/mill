import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The placement popover's own two pure decisions (goal 0081 slice A1),
// split out so both are Vitest-unit-testable without a React render --
// same "no React dependency, no reason to require one" reasoning
// HotkeyHint.tsx's own resolveHotkeyLabel already documents.

const LAST_KIND_STORAGE_KEY = 'atlas.lastKindId'
const PROMOTE_TITLE_MAX = 80

// resolveDefaultKindID picks the placement popover's own starting Kind:
// the last-used one if it still exists among kinds, else the first
// kind, else "" (no kinds declared yet). Pure -- the localStorage read
// itself lives in lastUsedKindID below, so this stays testable with a
// plain string in, no storage mock required.
export function resolveDefaultKindID(kinds: Kind[], lastUsedID: string | null): string {
  if (lastUsedID && kinds.some((k) => k.ID === lastUsedID)) return lastUsedID
  return kinds[0]?.ID ?? ''
}

export function lastUsedKindID(kinds: Kind[]): string {
  return resolveDefaultKindID(kinds, localStorage.getItem(LAST_KIND_STORAGE_KEY))
}

export function rememberLastUsedKind(kindID: string): void {
  localStorage.setItem(LAST_KIND_STORAGE_KEY, kindID)
}

// titleFromNoteText derives the promote popover's own prefilled title:
// the note's first line, trimmed, capped at PROMOTE_TITLE_MAX chars
// with an ellipsis -- never the whole multi-line body.
export function titleFromNoteText(text: string): string {
  const firstLine = (text.split('\n')[0] ?? '').trim()
  return firstLine.length > PROMOTE_TITLE_MAX ? `${firstLine.slice(0, PROMOTE_TITLE_MAX - 1)}…` : firstLine
}
