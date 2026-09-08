// Fixture for semgrep/no-raf-retry-loop.yml's positive probe (goal
// 0366): the pre-0390 ListGridGlide.tsx openRename shape -- a bounded
// counter re-invoking requestAnimationFrame until a library's layout
// rect becomes available, instead of the library's own readiness
// signal. Flat file, never imported and never scanned directly by the
// repo's own semgrep gate (deliberately outside frontend/src/**) --
// scripts/check-no-raf-retry-loop-selftest.sh copies it into a
// throwaway frontend/src/shared/ tree before scanning it.
export function openRename(col: number) {
  let tries = 0
  const attempt = () => {
    const bounds = gridRef.current?.getBounds(col, -1)
    if (bounds && bounds.width > 0) {
      setRenaming({ key: column.Key, at: toAnchor(bounds) })
      return
    }
    if (++tries < 30) window.requestAnimationFrame(attempt)
  }
  attempt()
}
