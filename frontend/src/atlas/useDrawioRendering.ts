import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

// Renders a .drawio card's own XML through drawio's own vendored viewer
// (ADR-0043, goal 0133 slice 3: adopt drawio's viewer rather than
// reimplementing mxGraph rendering). The file is self-hosted, not a
// CDN, and loaded lazily via a runtime <script> tag off a static asset
// URL -- Vite's asset pipeline never parses it as a JS module, so it
// never enters any Rollup chunk (frontend/public/vendor/drawio/
// PROVENANCE.md has the pinned source/license/checksum).
//
// GraphViewer.createViewerForElement (upstream:
// src/main/webapp/js/diagramly/GraphViewer.js) reads its config from
// the target element's own data-mxgraph attribute (a JSON string), not
// a function argument -- the attribute is set imperatively here rather
// than as a JSX prop, matching this hook's fully imperative DOM
// ownership (see the interface below).
interface DrawioGraphViewer {
  createViewerForElement: (element: Element, callback?: (viewer: unknown) => void) => void
}

declare global {
  interface Window {
    GraphViewer?: DrawioGraphViewer
  }
}

const VIEWER_SCRIPT_URL = '/vendor/drawio/viewer.min.js'

// A same-origin, deliberately-nonexistent path: every one of the
// globals below is used as a URL/path PREFIX, so pointing them here
// makes any resource lookup that isn't already bundled into the
// vendored script itself (an extended stencil, a proxied image, the
// MathJax bundle) fail as an honest local 404 instead of reaching the
// internet -- fail-closed, not silently degraded.
//
// Deliberately NOT an empty string: the vendored script sets each of
// these via `window.X = window.X || "<remote default>"`, and `''` is
// falsy in JS -- pinning to `''` is a no-op, the script's own
// assignment fires anyway and the remote default wins. A real
// (falsy-safe) local value is required to actually win that race.
const LOCAL_ONLY_BASE = '/vendor/drawio/unavailable'

// Every one of these resolves to a live diagrams.net/app.diagrams.net/
// github.com/gitlab.com endpoint the instant the vendored script's own
// top-level code runs, unless already set -- pinning them has to
// happen before that code executes. Enumerated directly against the
// pinned vendored file's own source (grep for `window\.[A-Z_a-z]*=
// window\.[A-Z_a-z]*\|\|`) rather than assumed from upstream docs.
// This list is a maintenance surface: frontend/e2e/atlas-drawio-
// unit.spec.ts asserts no request to any of these hosts happens while
// a .drawio card renders, so an update to the vendored file that adds
// a new remote-defaulting global is caught by that test, not silently
// missed here.
const LOCAL_ONLY_PATHS = [
  'mxBasePath', 'mxImageBasePath', 'STENCIL_PATH', 'SHAPES_PATH', 'STYLE_PATH', 'PROXY_URL',
  'DRAWIO_BASE_URL', 'DRAW_MATH_URL', 'DRAWIO_LIGHTBOX_URL', 'GRAPH_IMAGE_PATH', 'EXPORT_URL',
  'NOTIFICATIONS_URL', 'DRAWIO_GITHUB_API_URL', 'DRAWIO_GITHUB_URL', 'DRAWIO_GITLAB_URL',
  'SAVE_URL', 'OPEN_URL', 'CSS_PATH', 'IMAGE_PATH', 'RESOURCES_PATH', 'TEMPLATE_PATH',
  'NEW_DIAGRAM_CATS_PATH',
]

function pinLocalOnly() {
  const w = window as unknown as Record<string, string>
  for (const key of LOCAL_ONLY_PATHS) w[key] ??= LOCAL_ONLY_BASE
}

let viewerPromise: Promise<DrawioGraphViewer> | null = null

function loadDrawioViewer(): Promise<DrawioGraphViewer> {
  viewerPromise ??= new Promise((resolve, reject) => {
    pinLocalOnly()
    const script = document.createElement('script')
    script.src = VIEWER_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.GraphViewer) resolve(window.GraphViewer)
      else reject(new Error('drawio viewer script loaded without GraphViewer'))
    }
    script.onerror = () => reject(new Error('drawio viewer script failed to load'))
    document.head.appendChild(script)
  })
  return viewerPromise
}

// xml is a .drawio file's own raw content (the <mxfile>...</mxfile>
// wrapper, compressed or plain -- GraphViewer decodes either variant
// itself, so no Go-side decode is needed for this read-only render
// path). ref must point at an otherwise-empty element: GraphViewer owns
// its children imperatively and this hook never passes React a
// `children` prop for it, so unrelated re-renders can't clobber what
// GraphViewer draws (unlike a dangerouslySetInnerHTML swap, no memo
// boundary is needed here). Returns an error message once rendering
// has failed, empty otherwise -- editable/lightbox stay off: Mill
// views .drawio, it never opens drawio's own editor.
export function useDrawioRendering(ref: RefObject<HTMLElement | null>, xml: string | null): string {
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    const host = ref.current
    if (!host || !xml) return
    let cancelled = false
    host.setAttribute('data-mxgraph', JSON.stringify({ xml, resize: true, toolbar: 'zoom', editable: false, lightbox: false }))
    loadDrawioViewer()
      .then((GraphViewer) => {
        if (cancelled) return
        try {
          GraphViewer.createViewerForElement(host)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      host.innerHTML = ''
      host.removeAttribute('data-mxgraph')
    }
  }, [ref, xml])

  return error
}
