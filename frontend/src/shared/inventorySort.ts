// Shared last-updated-first sort + display formatting for every
// resource inventory (Workflows, Integrations, Lists, MCP Servers,
// Decisions, Environments) -- docs/SPEC.md §3.8's InventoryList entry:
// "inventories default-sort last-updated-first... zero-timestamp
// legacy data sorts below, migration-free." One implementation shared
// by every call site rather than six near-identical sort comparators
// (the same "one shared primitive, not five near-identical renderers"
// discipline goal 0007 already established for InventoryList itself).

// zeroTimeThreshold is the cutoff below which a timestamp counts as
// "unstamped" -- Go's zero time.Time value marshals as
// "0001-01-01T00:00:00Z", which JS's Date parses to a large negative
// year, not NaN. Year 2000 is a generous, unambiguous floor: nothing
// genuinely stamped by this feature will ever predate it, and a zero
// Go time is off by nearly two thousand years, not a handful of days.
const zeroTimeThresholdMs = Date.UTC(2000, 0, 1)

// parseUpdated returns the timestamp's epoch milliseconds, or null when
// the value is missing, unparseable, or before the zero-time threshold
// (pre-timestamp / legacy data, migration-free -- see this file's own
// header comment).
function parseUpdated(ts: unknown): number | null {
  if (typeof ts !== 'string' || ts === '') return null
  const ms = Date.parse(ts)
  if (Number.isNaN(ms) || ms < zeroTimeThresholdMs) return null
  return ms
}

// sortByUpdatedDesc returns a NEW array (stable sort, per Array.prototype.sort's
// own guarantee since ES2019 -- confirmed relied upon here, not assumed)
// ordered newest-updated-first. Anything unstamped sorts last, in its
// original relative order among other unstamped items -- migration-free:
// entities persisted before this feature shipped unmarshal with zero
// timestamps and must never reorder relative to each other.
export function sortByUpdatedDesc<T>(items: T[], getUpdated: (item: T) => unknown): T[] {
  return [...items]
    .map((item, index) => ({ item, index, ms: parseUpdated(getUpdated(item)) }))
    .sort((a, b) => {
      if (a.ms === null && b.ms === null) return a.index - b.index
      if (a.ms === null) return 1
      if (b.ms === null) return -1
      if (a.ms !== b.ms) return b.ms - a.ms
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['week', 1000 * 60 * 60 * 24 * 7],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
]

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// formatUpdated renders a short relative-time caption ("2m ago", "3h
// ago", "yesterday") for a row's trailing metadata, '' when unstamped.
// Built-in Intl.RelativeTimeFormat only -- no new dependency, per
// CLAUDE.md's adopt-before-hand-roll discipline (the formatting itself
// is exactly what Intl already solves). Falls back to
// toLocaleDateString beyond ~7 days, where a relative phrase stops
// being more useful than an actual date.
export function formatUpdated(ts: unknown): string {
  const ms = parseUpdated(ts)
  if (ms === null) return ''

  const diffMs = ms - Date.now()
  const absDiffMs = Math.abs(diffMs)

  if (absDiffMs < 1000 * 60 * 60 * 24 * 7) {
    for (const [unit, unitMs] of RELATIVE_UNITS) {
      if (absDiffMs >= unitMs || unit === 'minute') {
        const value = Math.round(diffMs / unitMs)
        // Intl.RelativeTimeFormat renders 0 as "in 0 minutes" -- "just
        // now" reads better for genuinely sub-minute freshness.
        if (value === 0) return 'just now'
        return relativeFormatter.format(value, unit)
      }
    }
  }

  return new Date(ms).toLocaleDateString()
}
