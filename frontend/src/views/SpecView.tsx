import { useEffect, useState } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'
import svgPanZoom from 'svg-pan-zoom'
import { useTheme } from '@primer/react'
import { SpecService } from '../../bindings/github.com/alicoding/mill'
import CapabilityIndex from './CapabilityIndex'
import CompositionCapabilityMap from '../composition/CompositionCapabilityMap'
import styles from './SpecView.module.css'

// Deliberately NOT flowchart.useMaxWidth: true -- that makes mermaid
// emit a responsive SVG (width="100%", no explicit height) meant for
// static CSS-driven scaling; false gives real pixel width/height
// attributes, which the viewBox fix below derives from. svg-pan-zoom's
// own fit/center options already do what useMaxWidth was for, so this
// isn't a loss. theme itself is NOT set here -- mermaid has no CSS-
// variable-driven live theming (it bakes each theme's actual color
// values into the generated SVG at render time, confirmed directly
// against its own output, not assumed), so it can't just inherit
// Primer's tokens the way every other element in the app does.
// SpecView's own color-mode effect below picks 'dark'/'default'
// (mermaid's own light theme name) from Primer's *resolved* color mode
// instead, and a companion effect re-parses+re-runs whenever that
// changes, since a color-mode switch needs a real re-render here, not
// just new CSS cascading into an already-drawn diagram.

// The one place the mermaid-block class name is defined -- used by both
// the renderer override below (what class it sets) and mermaid.run()'s
// querySelector (what it looks for), so the two can't silently drift the
// way an earlier version's hardcoded ".spec" selector did (that string
// was a CSS Modules class, hashed at build time, and never matched
// anything -- caught by an e2e assertion, not by inspection).
const MERMAID_CLASS = 'mermaid'

// Minimal marked+mermaid integration: a fenced ```mermaid block would
// otherwise render as plain <pre><code>, not a diagram. Overriding just
// this one code path (not marked's whole renderer) so a ```mermaid
// fence emits <pre class="mermaid"> instead.
const renderer = new marked.Renderer()
const defaultCode = renderer.code.bind(renderer)
renderer.code = (token) =>
  token.lang === 'mermaid' ? `<pre class="${MERMAID_CLASS}">${token.text}</pre>` : defaultCode(token)

function SpecView() {
  const { resolvedColorMode } = useTheme()
  // Raw fetched markdown, kept separate from the rendered `html` below
  // -- switching color mode needs to re-parse (and mermaid.run() needs
  // to re-render), not re-fetch from Go, so the source text has to
  // survive independently of the one-time SpecService.Get() call.
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [html, setHtml] = useState<string>('Loading spec...')
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    SpecService.Get()
      .then(setMarkdown)
      .catch((err) => setFetchError(String(err)))
  }, [])

  // mermaid.initialize() is a global config call, not scoped to one
  // render -- must run before the re-parse effect below fires for the
  // same resolvedColorMode change, so mermaid.run() (triggered by that
  // effect's html update, in a later render) picks up the right theme.
  // Declared first so React's per-render effect ordering guarantees
  // that sequencing.
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: resolvedColorMode === 'light' ? 'default' : 'dark',
      flowchart: { useMaxWidth: false },
    })
  }, [resolvedColorMode])

  useEffect(() => {
    if (fetchError !== null) {
      setHtml(`<p class="spec-error">Failed to load spec: ${fetchError}</p>`)
      return
    }
    if (markdown === null) return
    setHtml(marked.parse(markdown, { async: false, renderer }))
    // resolvedColorMode is a real dependency here, not incidental: it's
    // what forces a re-parse (and therefore a fresh mermaid.run()) when
    // the color mode changes, even though the markdown source itself
    // hasn't changed.
  }, [markdown, fetchError, resolvedColorMode])

  // Runs after each html update. mermaid.run() finds the `.mermaid`
  // elements the renderer override above produced and replaces their
  // text content with rendered SVG -- Mermaid itself has no pan/zoom at
  // all (checked directly against its own config schema, not assumed),
  // so once the SVG exists, svg-pan-zoom wraps each one to add real
  // drag-to-pan/scroll-to-zoom plus visible +/-/reset control icons.
  useEffect(() => {
    let panZooms: SvgPanZoom.Instance[] = []
    mermaid
      .run({ querySelector: `.${MERMAID_CLASS}` })
      .then(() => {
        const svgs = document.querySelectorAll<SVGSVGElement>(`.${MERMAID_CLASS} svg`)
        panZooms = Array.from(svgs).map((svg) => {
          // Mermaid's SVG has explicit width/height (flowchart.useMaxWidth:
          // false above) but never sets viewBox -- without one,
          // svg-pan-zoom's own transform math breaks and its control icons
          // render thousands of pixels off-screen (confirmed via
          // getBoundingClientRect(), a documented svg-pan-zoom issue for
          // any SVG missing a viewBox, not something specific to Mill).
          // Synthesizing one from the SVG's own rendered width/height
          // fixes it -- same numbers the SVG is already using, just
          // written to the attribute svg-pan-zoom actually reads.
          if (!svg.getAttribute('viewBox')) {
            const w = svg.width.baseVal.value
            const h = svg.height.baseVal.value
            svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
          }
          return svgPanZoom(svg, {
            zoomEnabled: true,
            controlIconsEnabled: true,
            fit: true,
            center: true,
            minZoom: 0.5,
            maxZoom: 10,
          })
        })
      })
      .catch(console.error)
    return () => panZooms.forEach((pz) => pz.destroy())
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
