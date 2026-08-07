import { useEffect, useState } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'
import { SpecService } from '../bindings/github.com/alicoding/mill'
import CapabilityIndex from './CapabilityIndex'
import CompositionCapabilityMap from './CompositionCapabilityMap'
import styles from './SpecView.module.css'

// theme: 'dark' matches Mill's own neon-dark chrome (index.css's
// color-scheme: dark); useMaxWidth keeps a wide diagram from
// overflowing the Spec pane's max-width -- SpecView.module.css's
// pre.mermaid rule gives it its own horizontal scroll instead.
mermaid.initialize({ startOnLoad: false, theme: 'dark', flowchart: { useMaxWidth: true } })

// Minimal marked+mermaid integration: a fenced ```mermaid block would
// otherwise render as plain <pre><code>, not a diagram. Overriding just
// this one code path (not marked's whole renderer) so a ```mermaid
// fence emits <pre class="mermaid"> instead -- mermaid.run() below
// finds elements by that class by default, no further wiring needed.
const renderer = new marked.Renderer()
const defaultCode = renderer.code.bind(renderer)
renderer.code = (token) =>
  token.lang === 'mermaid' ? `<pre class="mermaid">${token.text}</pre>` : defaultCode(token)

function SpecView() {
  const [html, setHtml] = useState<string>('Loading spec...')

  useEffect(() => {
    SpecService.Get()
      .then((markdown) => setHtml(marked.parse(markdown, { async: false, renderer })))
      .catch((err) => setHtml(`<p class="spec-error">Failed to load spec: ${String(err)}</p>`))
  }, [])

  // Runs after each html update -- mermaid.run() scans the DOM for
  // .mermaid elements (the ones the renderer override above just
  // produced) and replaces their text content with rendered SVG. No
  // querySelector override: the default ".mermaid" already matches (a
  // literal class the renderer above sets directly, not a CSS Modules
  // class -- unlike styles.spec, which is hashed at build time and can't
  // be referenced as a literal ".spec" string the way an earlier version
  // of this wrongly assumed).
  useEffect(() => {
    mermaid.run().catch(console.error)
  }, [html])

  return (
    <div className={styles.spec}>
      <CapabilityIndex />
      <CompositionCapabilityMap />
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

export default SpecView
