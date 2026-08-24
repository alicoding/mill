// A tiny leaf-rule scanner for the surface-conformance tests (goal
// 0181 S3): CSS Modules ship as real .css files on disk, so a Node-side
// test can read one as TEXT and check it for a structural pattern --
// no jsdom/rendering harness needed (this repo carries none for React
// components; see atlasBoardSurfaceConformance.test.ts's own header for
// why that's the deliberate choice here, not an oversight).
//
// Matches only LEAF declaration blocks -- `selector { decl: value; }`
// with no nested `{`/`}` inside. An @media wrapper's own "selector"
// (`@media (prefers-reduced-motion: reduce)`) never matches this regex
// itself (its body contains nested braces), so its inner leaf rules are
// still found, just not the wrapper -- exactly what every caller here
// wants: real selectors, never at-rule conditions.
export interface CssLeafRule {
  selector: string
  body: string
}

export function parseLeafCssRules(cssText: string): CssLeafRule[] {
  // Comments stripped first: every file here carries a header comment
  // immediately above a rule, and the header comment doesn't get
  // swallowed into a selector for the match right after it.
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssLeafRule[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(withoutComments)) !== null) {
    const selector = match[1].trim()
    if (selector === '') continue
    rules.push({ selector, body: match[2] })
  }
  return rules
}
