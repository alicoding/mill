import { describe, expect, it } from 'vitest'
import { CHECK_ICON_SVG, COPY_ICON_SVG, injectCodeCopyButtons } from './docsCodeCopy'

describe('injectCodeCopyButtons', () => {
  it('wraps a fenced code block with a labeled copy button, preserving the language class', () => {
    const html = '<p>Before.</p>\n<pre><code class="language-go">fmt.Println("hi")\n</code></pre>\n<p>After.</p>'
    const got = injectCodeCopyButtons(html, 'wrapClass', 'btnClass', 'Copy code')
    expect(got).toBe(
      '<p>Before.</p>\n' +
        '<div class="wrapClass" data-testid="docs-code-block"><pre><code class="language-go">fmt.Println("hi")\n</code></pre>' +
        `<button type="button" class="btnClass" data-testid="docs-code-copy" aria-label="Copy code">${COPY_ICON_SVG}</button></div>\n` +
        '<p>After.</p>',
    )
  })

  it('wraps a fenceless/indented code block with no language class', () => {
    const html = '<pre><code>plain text\n</code></pre>'
    const got = injectCodeCopyButtons(html, 'wrapClass', 'btnClass', 'Copy code')
    expect(got).toContain('<pre><code>plain text\n</code></pre>')
    expect(got).toContain('data-testid="docs-code-copy"')
  })

  it('wraps every code block on a page with multiple fences', () => {
    const html = '<pre><code class="language-go">a()</code></pre><p>mid</p><pre><code class="language-ts">b()</code></pre>'
    const got = injectCodeCopyButtons(html, 'wrapClass', 'btnClass', 'Copy code')
    expect(got.match(/data-testid="docs-code-copy"/g)).toHaveLength(2)
  })

  it('escapes a copy label that would otherwise break the attribute', () => {
    const html = '<pre><code>x</code></pre>'
    const got = injectCodeCopyButtons(html, 'wrapClass', 'btnClass', 'Copy "code" & more')
    expect(got).toContain('aria-label="Copy &quot;code&quot; &amp; more"')
  })

  it('leaves inline code (not inside a pre) untouched', () => {
    const html = '<p>Run <code>go test</code> before pushing.</p>'
    const got = injectCodeCopyButtons(html, 'wrapClass', 'btnClass', 'Copy code')
    expect(got).toBe(html)
  })

  it('exports distinct copy and check icon markup', () => {
    expect(COPY_ICON_SVG).not.toBe(CHECK_ICON_SVG)
    expect(COPY_ICON_SVG).toContain('<svg')
    expect(CHECK_ICON_SVG).toContain('<svg')
  })
})
