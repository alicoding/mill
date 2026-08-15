// Shared by HomeView.tsx and HomeMostUsed.tsx -- one place to change
// how a minutes total reads (docs/goals/0014-home-dashboard.md's own
// "31 runs × ~4 min = ~2.1 hrs" example uses hours once the number gets
// large; keeping under an hour as plain minutes is more legible than
// "0.2 hrs"). Takes `t` like every other pure-formatter in this
// migration (docs/goals/archive/0032-copy-management.md) since the unit words
// themselves ("min"/"hrs") are user-facing copy, not baked into the
// function at module-load time.
export function formatMinutes(t: (key: string, opts?: Record<string, unknown>) => string, totalMinutes: number): string {
  if (totalMinutes < 60) return t('homeFormat.minutes', { n: totalMinutes })
  const hours = totalMinutes / 60
  return t('homeFormat.hours', { n: hours.toFixed(hours < 10 ? 1 : 0) })
}

// Formats a run duration (goal 0051 item 1) -- seconds under a minute
// read as whole seconds (sub-second runs round to "0s" rather than a
// misleadingly precise decimal, since Home's KPI is "roughly how long
// does this take," not a profiler); a minute or more switches to
// minutes+seconds, matching formatMinutes' own under/over-an-hour
// split one level down.
export function formatDuration(t: (key: string, opts?: Record<string, unknown>) => string, totalSeconds: number): string {
  // Round once, up front -- rounding minutes/seconds separately after
  // splitting can carry a fractional remainder past 59 (e.g. 119.6s
  // would otherwise read minutes=1, seconds=round(59.6)=60).
  const rounded = Math.round(totalSeconds)
  if (rounded < 60) return t('homeFormat.seconds', { n: rounded })
  return t('homeFormat.minutesSeconds', { m: Math.floor(rounded / 60), s: rounded % 60 })
}
