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
