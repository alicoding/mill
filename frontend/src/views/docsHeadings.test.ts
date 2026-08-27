import { describe, expect, it } from 'vitest'
import { injectHeadingAnchors, parseHeadings } from './docsHeadings'

const SAMPLE_HTML = `<h1 id="title">Title</h1>
<p>Intro text.</p>
<h2 id="section-one">Section One</h2>
<p>Body.</p>
<h3 id="subsection">A Subsection</h3>
<p>More body.</p>
<h2 id="section-two"><code>Configured</code> things</h2>
<p>End.</p>`

describe('parseHeadings', () => {
  it('lists every h2/h3 in document order, skipping the h1', () => {
    expect(parseHeadings(SAMPLE_HTML)).toEqual([
      { id: 'section-one', text: 'Section One', level: 2 },
      { id: 'subsection', text: 'A Subsection', level: 3 },
      { id: 'section-two', text: 'Configured things', level: 2 },
    ])
  })

  it('returns an empty list for a page with no h2/h3', () => {
    expect(parseHeadings('<h1 id="title">Title</h1><p>No sections.</p>')).toEqual([])
  })
})

describe('injectHeadingAnchors', () => {
  it('appends a labeled anchor link inside each h2/h3, after its existing content', () => {
    const got = injectHeadingAnchors(SAMPLE_HTML, 'anchorClass', (text) => `Link to ${text}`)
    expect(got).toContain(
      '<h2 id="section-one">Section One<a href="#section-one" class="anchorClass" aria-label="Link to Section One" data-testid="docs-heading-anchor">#</a></h2>',
    )
    // The h1 is untouched -- anchors are a TOC-rail affordance, and
    // the page's own h1 is suppressed from render entirely (S1's
    // .article :global(h1):first-child rule).
    expect(got).toContain('<h1 id="title">Title</h1>')
  })

  it('escapes a heading label that would otherwise break the attribute', () => {
    const html = '<h2 id="q">A "quoted" & <em>emphatic</em> title</h2>'
    const got = injectHeadingAnchors(html, 'a', (text) => text)
    expect(got).toContain('aria-label="A &quot;quoted&quot; &amp; emphatic title"')
  })
})
