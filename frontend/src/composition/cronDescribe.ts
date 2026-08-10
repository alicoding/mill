import cronstrue from 'cronstrue'

// Pure humanize step behind SchedulePreview.tsx's own rendering and the
// trigger-aware Workflows-list row label (docs/goals/0006-trigger-aware-
// workflows-list.md) -- extracted so both agree on the exact same
// cronstrue call instead of two independent, driftable call sites.
// Returns a discriminated shape rather than a pre-formatted string so
// each caller keeps its own presentation (SchedulePreview wraps a
// shortcut in <code>; the compact row label doesn't).
export type CronDescription =
  | { kind: 'shortcut'; value: string }
  | { kind: 'described'; text: string }
  | { kind: 'invalid' }

// netresearch/go-cron (the Go scheduler, goal 0001) accepts @every/
// @hourly shortcuts cronstrue can't parse, so those get their own
// branch instead of a failed parse; an in-progress edit can briefly be
// neither a shortcut nor valid standard cron, which 'invalid' covers.
// Callers own what an EMPTY string means (SchedulePreview renders
// nothing at all; the row label shows "no schedule set") -- describeCron
// only describes a non-empty value.
export function describeCron(cron: string): CronDescription {
  const value = cron.trim()
  if (value.startsWith('@')) {
    return { kind: 'shortcut', value }
  }
  try {
    return { kind: 'described', text: cronstrue.toString(value, { verbose: true, throwExceptionOnParseError: true }) }
  } catch {
    return { kind: 'invalid' }
  }
}
