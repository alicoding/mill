// The converged attribute set every search/filter field ships (goal
// 0272): a query box is not prose, so the platform's text assistance
// -- autocomplete dropdowns, autocorrect rewrites, auto-capitalization,
// spellcheck underlines -- must all stand down. One constant spread
// into every search input (palette, quick panel, docs search,
// clipboard history, list filters) so the next search field can't
// forget half the set.
export const searchInputTextAssistOff = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
} as const

// The same set as plain DOM attributes, for inputs Mill doesn't render
// itself -- a vendored engine's own document (the pdf.js viewer's
// findbar) reached through an iframe seam. WKWebView applies the OS's
// autocorrect to any input that doesn't opt out, and a vendored viewer
// built for Firefox never does; the parent applies these post-load
// rather than patching the vendored tree.
export const searchInputTextAssistOffAttrs: ReadonlyArray<[string, string]> = [
  ['autocomplete', 'off'],
  ['autocorrect', 'off'],
  ['autocapitalize', 'none'],
  ['spellcheck', 'false'],
]

export function applyTextAssistOff(doc: Document, selector: string): void {
  for (const el of doc.querySelectorAll(selector)) {
    for (const [name, value] of searchInputTextAssistOffAttrs) {
      el.setAttribute(name, value)
    }
  }
}
