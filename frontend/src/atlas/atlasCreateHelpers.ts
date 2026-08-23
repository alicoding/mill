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
// with an ellipsis -- never the whole multi-line body. Reused as-is for
// the paste door's own title (goal 0081 slice A3, LOCKED design §2b):
// "first line, trimmed" is the same rule for a pasted note and a pasted
// block of clipboard text, so this stays the one function rather than
// a duplicate spelled "paste".
export function titleFromNoteText(text: string): string {
  const firstLine = (text.split('\n')[0] ?? '').trim()
  return firstLine.length > PROMOTE_TITLE_MAX ? `${firstLine.slice(0, PROMOTE_TITLE_MAX - 1)}…` : firstLine
}

// titleFromFilename derives the instant file-landing door's own title
// (goal 0081 slice A3, LOCKED design §3b): the filename without its
// extension or directory -- the path IS the record, so nothing here
// humanizes separators the way atlasFolderScanGrouping's own suggested
// titles do; a dropped file's title should read exactly as it's named
// on disk.
export function titleFromFilename(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

// normalizeLocalPathInput turns the image tool's own path/URL field
// (goal 0169 slice 2) into a plain filesystem path: a dragged-in
// `file://` URL (macOS commonly inserts one when a file is dropped into
// a plain text field) has its scheme stripped and its percent-encoding
// decoded; anything else passes through trimmed, unchanged. Pure --
// this never touches the filesystem itself, MirrorPath validity is the
// backend's own job (CreateCardFromFileDrop).
export function normalizeLocalPathInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed.startsWith('file://')) return trimmed
  const withoutScheme = trimmed.slice('file://'.length)
  try {
    return decodeURIComponent(withoutScheme)
  } catch {
    return withoutScheme
  }
}
