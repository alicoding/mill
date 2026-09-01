// Pure string transforms over a rendered docs page's HTML (goal 0235
// S2): both the TOC rail's heading list and the hover-revealed
// heading-anchor links read the SAME h2/h3 `id` attribute
// markdown.RenderDocsHTML now emits (the S1-deferred prerequisite).
// Deliberately string-based rather than a DOM walk -- this project's
// Vitest suite runs under Node, no jsdom/happy-dom environment
// (testing.md's "@testing-library component layer" was evaluated and
// rejected), so a DOM-dependent extractor would be untestable at the
// unit layer; a regex over goldmark's own single-line ATX heading
// output is exact for controlled, self-rendered content the way it
// would not be for arbitrary attacker HTML.

export interface DocsHeading {
  id: string
  text: string
  level: 2 | 3
}

const HEADING_RE = /<h([23])\s+id="([^"]+)">([\s\S]*?)<\/h\1>/g

// Fixpoint loop, not a single strip-tags pass: one replace leaves
// reassembled fragments behind ("<scr<script>ipt>" collapses back
// into a tag -- the incomplete-multi-character-sanitization class),
// so strip until stable, then drop any residual unclosed "<..." tail.
// Runs in both browser and node test env (no DOMParser dependency).
function stripTags(inner: string): string {
  let out = inner
  for (;;) {
    const next = out.replace(/<[^>]*>/g, '')
    if (next === out) break
    out = next
  }
  return out.replace(/<[^>]*$/, '').trim()
}

// escapeAttr guards the injected aria-label/href against a heading
// whose text legitimately contains an attribute-breaking character
// (a quote, an ampersand) -- goldmark's own heading text is already
// HTML-escaped by the time it reaches here, but the label re-derives
// plain text via stripTags above, so it needs the same treatment
// before going back into an attribute.
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// parseHeadings lists every h2/h3 in document order -- the TOC rail's
// own row order and the scroll-spy's observed sequence.
export function parseHeadings(html: string): DocsHeading[] {
  const out: DocsHeading[] = []
  for (const m of html.matchAll(HEADING_RE)) {
    const level = Number(m[1]) as 2 | 3
    out.push({ id: m[2], text: stripTags(m[3]), level })
  }
  return out
}

// injectHeadingAnchors appends a hover-revealed "#" link (anchorClassName
// drives the CSS module's opacity-on-hover rule) inside each h2/h3,
// after its existing content -- clicking it is intercepted by the same
// delegated handler DocsView already uses for cross-page links, never
// a real page navigation.
export function injectHeadingAnchors(html: string, anchorClassName: string, labelFor: (headingText: string) => string): string {
  return html.replace(HEADING_RE, (match, level: string, id: string, inner: string) => {
    const text = stripTags(inner)
    const label = escapeAttr(labelFor(text))
    return `<h${level} id="${id}">${inner}<a href="#${id}" class="${anchorClassName}" aria-label="${label}" data-testid="docs-heading-anchor">#</a></h${level}>`
  })
}
