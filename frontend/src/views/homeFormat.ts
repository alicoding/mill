// Shared by HomeView.tsx and HomeMostUsed.tsx -- one place to change
// how a minutes total reads (docs/goals/0014-home-dashboard.md's own
// "31 runs × ~4 min = ~2.1 hrs" example uses hours once the number gets
// large; keeping under an hour as plain minutes is more legible than
// "0.2 hrs").
export function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = totalMinutes / 60
  return `${hours.toFixed(hours < 10 ? 1 : 0)} hrs`
}
