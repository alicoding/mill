// Fixture for semgrep/no-raf-retry-loop.yml's negative probe (goal
// 0366): a single requestAnimationFrame call deferring focus to the
// next paint, not a bounded retry loop. Flat file, never imported and
// never scanned directly by the repo's own semgrep gate (deliberately
// outside frontend/src/**) -- scripts/check-no-raf-retry-loop-selftest.sh
// copies it into a throwaway frontend/src/shared/ tree before scanning it.
export function useFocusNextPaint(inputRef: { current: HTMLInputElement | null }) {
  window.requestAnimationFrame(() => {
    inputRef.current?.focus()
  })
}
