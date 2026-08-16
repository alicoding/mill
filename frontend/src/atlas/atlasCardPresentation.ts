import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// Pure derivations behind the note card's front/back faces (goal 0072
// slice A) -- kept dependency-free like atlasGrouping.ts/atlasBoardLayout.ts
// so every value a card renders is independently unit-testable, not
// re-derived ad hoc inside the React node components that display it.

export type FileTagLabel = 'MD' | 'IMG' | 'PDF' | 'URL'
export type FileTagColor = 'success' | 'attention' | 'danger'

export interface FileTag {
  label: FileTagLabel
  color: FileTagColor
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

function extensionOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  if (dot <= slash) return ''
  return path.slice(dot).toLowerCase()
}

// deriveFileTag follows the ordered chain the ratified design spells
// out: a recognized MirrorPath extension wins first, then a bare
// Source URL, then no tag at all -- an unrecognized MirrorPath
// extension with no Source set falls through to no tag rather than a
// generic fallback label.
export function deriveFileTag(card: Pick<Card, 'Source' | 'MirrorPath'>): FileTag | null {
  if (card.MirrorPath) {
    const ext = extensionOf(card.MirrorPath)
    if (ext === '.md' || ext === '.markdown') return { label: 'MD', color: 'success' }
    if (IMAGE_EXTENSIONS.has(ext)) return { label: 'IMG', color: 'attention' }
    if (ext === '.pdf') return { label: 'PDF', color: 'danger' }
  }
  if (card.Source) return { label: 'URL', color: 'attention' }
  return null
}

const FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function hasMirror(card: Pick<Card, 'MirrorPath'>): boolean {
  return Boolean(card.MirrorPath)
}

// freshnessDotColor is null exactly when the card carries no mirror at
// all (the dot is absent, per the ratified front face); a mirror that
// has never synced (zero LastSyncedAt) reads as stale, same as one
// synced more than 7 days ago.
export function freshnessDotColor(card: Pick<Card, 'MirrorPath' | 'LastSyncedAt'>, now: number = Date.now()): 'fresh' | 'stale' | null {
  if (!hasMirror(card)) return null
  const raw = card.LastSyncedAt as unknown
  if (!raw) return 'stale'
  const t = new Date(raw as string).getTime()
  if (Number.isNaN(t)) return 'stale'
  return now - t <= FRESHNESS_WINDOW_MS ? 'fresh' : 'stale'
}

export interface FreshnessRollup {
  fresh: number
  stale: number
}

// computeFreshnessRollup tallies a region frame's own direct children
// (never grandchildren) that carry a mirror -- the header row's "N
// fresh"/"N stale" pills, present only when at least one child has a
// mirror to report on.
export function computeFreshnessRollup(children: Card[], now: number = Date.now()): FreshnessRollup {
  let fresh = 0
  let stale = 0
  for (const c of children) {
    const color = freshnessDotColor(c, now)
    if (color === 'fresh') fresh++
    else if (color === 'stale') stale++
  }
  return { fresh, stale }
}

// hostnameOf renders a Source URL's own host for the back face's
// "source: <hostname>" row -- falls back to the raw value when it
// doesn't parse as a URL (a bare hostname/path a user typed by hand).
export function hostnameOf(source: string): string {
  try {
    return new URL(source).hostname
  } catch {
    return source
  }
}

// basenameOf renders a MirrorPath's own filename for the back face's
// "mirror: <basename>" row.
export function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

// daysSinceSync renders the back face's "stale Nd" figure -- 0 for a
// mirror that has never synced (LastSyncedAt at its zero value), same
// "infinitely old reads as day zero of a very long staleness" floor
// freshnessDotColor's own null-vs-stale handling already applies.
export function daysSinceSync(lastSyncedAt: unknown, now: number = Date.now()): number {
  if (!lastSyncedAt) return 0
  const t = new Date(lastSyncedAt as string).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / (24 * 60 * 60 * 1000)))
}
