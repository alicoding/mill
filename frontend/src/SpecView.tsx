import { useEffect, useState } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'
import svgPanZoom from 'svg-pan-zoom'
import { SpecService } from '../bindings/github.com/alicoding/mill'
import CapabilityIndex from './CapabilityIndex'
import CompositionCapabilityMap from './CompositionCapabilityMap'
import styles from './SpecView.module.css'

// theme: 'dark' matches Mill's own neon-dark chrome (index.css's
// color-scheme: dark). Deliberately NOT flowchart.useMaxWidth: true --
// that makes mermaid emit a responsive SVG (width="100%", no explicit
// height) meant for static CSS-driven scaling; false gives real pixel
// width/height attributes, which the viewBox fix below derives from.
// svg-pan-zoom's own fit/center options already do what useMaxWidth was
// for, so this isn't a loss.
mermaid.initialize({ startOnLoad: false, theme: 'dark', flowchart: { useMaxWidth: false } })

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
  const [html, setHtml] = useState<string>('Loading spec...')

  useEffect(() => {
    SpecService.Get()
      .then((markdown) => setHtml(marked.parse(markdown, { async: false, renderer })))
      .catch((err) => setHtml(`<p class="spec-error">Failed to load spec: ${String(err)}</p>`))
  }, [])

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
