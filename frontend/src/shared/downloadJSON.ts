// The standard browser Blob + synthetic-anchor-click download mechanism,
// used identically by every Configure entity's Export button
// (ConfigureRequests/Lists/MCPServers.tsx) -- extracted once the same
// ~8 lines were about to be written a third time (CLAUDE.md: three
// similar lines is fine, a fourth repetition is the actual signal to
// share it). Works the same inside Mill's own Wails webview as it does
// in a normal browser tab, no native file-save API needed. Composition's
// own Export button (CompositionView.tsx, built first) keeps its
// original inline version rather than being retrofitted to this --
// already shipped and tested, and churning it for a marginal DRY gain
// isn't worth the re-verification cost.
export function downloadJSON(filename: string, json: string) {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
