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
