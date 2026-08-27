import { COMMANDS } from './commands'

// The four ids app/quickPanelActionEntries.tsx renders with bespoke
// presentation (goal 0222 S2) -- a panel-specific run() or copy/visuals
// the generic fallback can't supply (see that file's own RICH_ROWS
// comment). Kept here, not there, so the row-membership/ordering rule
// below is unit-testable without pulling in Primer/React (testing.md's
// "components are proven in e2e, not unit tests" layering -- a plain
// Vitest node run can't process the CSS a Primer JSX import drags in).
export const QUICK_PANEL_RICH_ROW_ORDER = ['panel.openMill', 'settings.open', 'view.review', 'panel.applyClipboard', 'codingLoop.run']

// Every quickPanel-opted-in, currently-enabled command id, in render
// order: the four rich rows first (fixed order), then any other
// quickPanel command in registry order -- app/quickPanelActionEntries.tsx's
// buildActionRows consumes this list rather than re-deriving the
// filter, so the membership/ordering rule lives in exactly one place.
export function quickPanelRowIds(): string[] {
  const isAvailable = (id: string): boolean => {
    const command = COMMANDS.find((c) => c.id === id)
    return command?.quickPanel === true && (!command.enabled || command.enabled())
  }
  const ids: string[] = []
  for (const id of QUICK_PANEL_RICH_ROW_ORDER) {
    if (isAvailable(id)) ids.push(id)
  }
  for (const command of COMMANDS) {
    if (!command.quickPanel || QUICK_PANEL_RICH_ROW_ORDER.includes(command.id)) continue
    if (command.enabled && !command.enabled()) continue
    ids.push(command.id)
  }
  return ids
}
