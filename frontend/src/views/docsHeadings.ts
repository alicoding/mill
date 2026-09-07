// DOM transforms over a rendered docs page's HTML (goal 0235 S2, goal
// 0382): both the TOC rail's heading list and the hover-revealed
// heading-anchor links read the SAME h2/h3 `id` attribute
// markdown.RenderDocsHTML now emits (the S1-deferred prerequisite).
// Parsed via DOMParser -- jsdom is the Vitest environment for this
// file's test (frontend/package.json already carries it for the same
// reason elsewhere), so a real HTML parser resolves nested/malformed
// markup the same way the browser that later renders this string
// will, which a regex over markup cannot guarantee (a reassembled
// fragment like "<scr<script>ipt>" is exactly the failure class a real
// parser doesn't have).

export interface DocsHeading {
  id: string
  text: string
  level: 2 | 3
}

// escapeAttr guards a caller-supplied string against breaking the HTML
// attribute it's placed into (docsCodeCopy's copy-button label, built
// as a string rather than through the DOM).
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// parseHeadings lists every h2/h3 in document order -- the TOC rail's
// own row order and the scroll-spy's observed sequence.
export function parseHeadings(html: string): DocsHeading[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('h2[id], h3[id]')).map((el) => ({
    id: el.id,
    text: (el.textContent ?? '').trim(),
    level: el.tagName === 'H2' ? 2 : 3,
  }))
}

// injectHeadingAnchors appends a hover-revealed "#" link (anchorClassName
// drives the CSS module's opacity-on-hover rule) inside each h2/h3,
// after its existing content -- clicking it is intercepted by the same
// delegated handler DocsView already uses for cross-page links, never
// a real page navigation. The anchor's attributes are set through the
// DOM, so the serializer -- not a hand-written escape -- guards them.
export function injectHeadingAnchors(html: string, anchorClassName: string, labelFor: (headingText: string) => string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const heading of Array.from(doc.querySelectorAll('h2[id], h3[id]'))) {
    const text = (heading.textContent ?? '').trim()
    const anchor = doc.createElement('a')
    anchor.setAttribute('href', `#${heading.id}`)
    anchor.setAttribute('class', anchorClassName)
    anchor.setAttribute('aria-label', labelFor(text))
    anchor.setAttribute('data-testid', 'docs-heading-anchor')
    anchor.textContent = '#'
    heading.appendChild(anchor)
  }
  return doc.body.innerHTML
}
