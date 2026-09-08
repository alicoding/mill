import { formatUpdated } from '../shared/inventorySort'

/** api.formatDate's implementation: 'relative' reuses the app's own
 * relative-time phrasing (shared/inventorySort.ts's formatUpdated,
 * the same one every last-updated caption in Mill's own interface
 * renders), falling back to a locale date beyond its own ~7-day
 * window; 'short'/'long' are a locale date, and a locale date+time,
 * matching formatRunStartedAt's own toLocaleString() convention
 * (shared/runTime.ts) — one shared implementation rather than a
 * plugin inventing its own Date math. An unparseable iso answers '—',
 * never a NaN-shaped string. */
export function formatPluginDate(iso: string, style: 'relative' | 'short' | 'long' = 'relative'): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  if (style === 'short') return new Date(ms).toLocaleDateString()
  if (style === 'long') return new Date(ms).toLocaleString()
  return formatUpdated(iso) || new Date(ms).toLocaleDateString()
}
