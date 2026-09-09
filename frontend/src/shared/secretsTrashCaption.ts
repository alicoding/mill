import type { TFunction } from 'i18next'
import { formatUpdated } from './inventorySort'

// The Trash row's own caption (goal 0406 S2 Contract item 1): "Deleted
// <relative> · gone in <n> days" -- relative reuses shared/
// inventorySort.ts's own relative-time formatter (the same one every
// other InventoryList row already renders its updated time through,
// adopted rather than a second hand-rolled one); daysLeft is derived
// from ExpiresAt (TrashSummary's own retention-derived field,
// secretsvc's toTrashSummary), never recomputed from a hardcoded 30
// here, so a future retention change needs no matching edit on this
// side.
//
// now defaults to the real clock but is a real parameter, the same
// "honored end to end" contract formatUpdated's own header comment
// documents -- a fixed now is what makes the boundary (a row trashed
// exactly 30 days ago reads "gone in 0 days," not "-1") testable
// without a fake timer.
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  const ms = Date.parse(expiresAt)
  if (Number.isNaN(ms)) return 0
  return Math.max(0, Math.ceil((ms - now) / (1000 * 60 * 60 * 24)))
}

export function formatTrashCaption(t: TFunction<'secrets'>, deletedAt: string, expiresAt: string, now: number = Date.now()): string {
  const days = daysLeft(expiresAt, now)
  return t('trash.caption', { relative: formatUpdated(deletedAt, now), days, count: days })
}
