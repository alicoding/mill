import { formatUpdated } from './inventorySort'

// Shared age-tier/expiry/liveness presentation for every "someone is
// waiting on a human" surface (docs/goals/0026 items 2/3/8): a pending
// MCP write, a guardrail/human-review park, and a stuck-ENQUEUED run
// all share the same 24h clock (ADR-0032's expiry, mirrored by the
// guardrail park's own timeout, §8) and the same owner-observed
// problem -- a stale item reading exactly as urgent as a fresh one
// ("feels like I missed something / it's not working"). One
// implementation, reused by ReviewView/MCPWriteApprovals/ApprovalPrompt
// (item 2), the requester-liveness hint (item 3), and
// WorkflowRunsPanel/ActivityRunsExplorer's stuck-ENQUEUED presentation
// (item 8) -- not five near-identical age calculations.

// STALE_AGE_THRESHOLD_MS: the age-tier cutoff (item 2's "<15m as-is;
// older gets emphasis"). Deliberately not configurable -- a single
// fixed bar, same as formatUpdated's own fixed relative-time bucket.
export const STALE_AGE_THRESHOLD_MS = 15 * 60 * 1000

// MCP_WRITE_EXPIRY_MS mirrors mcpWriteExpiry (millmcpservice_approval.go)
// and the guardrail park's own timeout (§8) -- the one 24h clock every
// "expires in Nh" caption reads from.
export const MCP_WRITE_EXPIRY_MS = 24 * 60 * 60 * 1000

// POLL_STALE_THRESHOLD_MS: item 3's own ">5m stale" bar for the
// requester-liveness hint -- deliberately different from (smaller than)
// the age-tier threshold, since polling is a much higher-frequency
// signal than "how old is this ask."
export const POLL_STALE_THRESHOLD_MS = 5 * 60 * 1000

export type AgeTier = 'fresh' | 'aging'

// toMillis parses a Go-emitted RFC3339 timestamp (or a Date, or
// null/undefined -- every optional *time.Time field arrives as
// undefined when unset, not a zero-value string) into epoch
// milliseconds, or null when there's nothing real to compute from.
// Deliberately simpler than inventorySort.ts's parseUpdated: every
// timestamp this module reads (CreatedAt on a pending write, StartedAt
// on a run) is always real once present -- there's no "legacy
// zero-value Go time" case to filter out here, unlike an entity's
// UpdatedAt.
function toMillis(ts: string | Date | null | undefined): number | null {
  if (ts == null || ts === '') return null
  const ms = typeof ts === 'string' ? Date.parse(ts) : ts.getTime()
  return Number.isNaN(ms) ? null : ms
}

// ageTier classifies how long ago createdAt was, against thresholdMs
// (the shared 15-minute bar, item 2, by default -- item 8's
// stuck-ENQUEUED presentation passes its own 5-minute bar instead,
// "same tier language" at a different cutoff, not a second mechanism).
// An unparseable/missing timestamp reads as 'fresh' -- never invent
// emphasis over data that isn't really there.
export function ageTier(
  createdAt: string | Date | null | undefined,
  now: number = Date.now(),
  thresholdMs: number = STALE_AGE_THRESHOLD_MS,
): AgeTier {
  const ms = toMillis(createdAt)
  if (ms === null) return 'fresh'
  return now - ms >= thresholdMs ? 'aging' : 'fresh'
}

// formatExpiresIn renders "expires in Nh" / "expires in Nm" counting
// down from createdAt + expiryMs (default: the shared 24h clock).
// '' when createdAt is missing/unparseable (nothing to compute); once
// the deadline has actually passed (the lazy sweep just hasn't caught
// up to relabel the record yet) renders 'expires imminently' rather
// than a confusing negative duration.
export function formatExpiresIn(
  createdAt: string | Date | null | undefined,
  expiryMs: number = MCP_WRITE_EXPIRY_MS,
  now: number = Date.now(),
): string {
  const ms = toMillis(createdAt)
  if (ms === null) return ''
  const remaining = ms + expiryMs - now
  if (remaining <= 0) return 'expires imminently'
  const hours = remaining / (60 * 60 * 1000)
  if (hours >= 1) return `expires in ${Math.ceil(hours)}h`
  const minutes = Math.max(1, Math.ceil(remaining / (60 * 1000)))
  return `expires in ${minutes}m`
}

// isPollStale answers item 3's own gate: has it been long enough since
// the requester last polled (check_write_status) that surfacing it is
// worth the pixels, rather than noise on every fresh poll. A never-
// polled write (lastPolledAt undefined) deliberately reads as NOT
// stale here -- there's nothing to say yet, and the age-tier emphasis
// above already covers "this is old," so this stays specifically about
// requester liveness, not a second staleness signal wearing the same
// clothes.
export function isPollStale(
  lastPolledAt: string | Date | null | undefined,
  now: number = Date.now(),
  thresholdMs: number = POLL_STALE_THRESHOLD_MS,
): boolean {
  const ms = toMillis(lastPolledAt)
  if (ms === null) return false
  return now - ms >= thresholdMs
}

// formatLastChecked renders "requester last checked Nm ago" -- '' when
// there's nothing to say (never polled, or not stale enough yet per
// isPollStale). Reuses formatUpdated for the relative-time phrase
// rather than a second Intl.RelativeTimeFormat instance.
export function formatLastChecked(lastPolledAt: string | Date | null | undefined, now: number = Date.now()): string {
  if (!isPollStale(lastPolledAt, now)) return ''
  const rel = formatUpdated(lastPolledAt as string)
  return rel ? `requester last checked ${rel}` : ''
}
