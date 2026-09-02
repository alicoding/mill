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
  createViewerForElement: (element: Element, callback?: (viewer: DrawioViewerInstance) => void) => void
}

// The instance the callback receives. `toolbar` is the hover toolbar
// (zoom/pages cluster) -- GraphViewer.prototype.addToolbar's own
// `this.toolbar`. It is NOT a child of the host: unless the config sets
// toolbar-nohide, the viewer appends it to document.body on pointer
// enter, absolutely positioned over the host, and removes it again on
// leave (viewer.min.js, addToolbar's body-append branch).
interface DrawioViewerInstance {
  toolbar?: HTMLElement
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

// General/Flowchart-class stencil XML is vendored locally (goal 0224
// S1, frontend/public/vendor/drawio/stencils/PROVENANCE.md carries the
// pinned-commit source + the stencil subtree's own license). Every
// OTHER stencil library (UML/AWS/network/...) still resolves through
// LOCAL_ONLY_BASE below and degrades to a default box -- the viewer's
// own mxStencilRegistry.getStencil loop tries a paired SHAPES_PATH
// *.js painter first and an XML stencil file second per library
// (viewer.min.js's `libraries.basic`/`libraries.flowchart` entries);
// the .js entry 404s against LOCAL_ONLY_BASE and is skipped silently
// (status check, not a thrown error), so the .xml entry alone is
// enough to render real stencil geometry for a vendored library.
const STENCIL_PATH = '/vendor/drawio/stencils'

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
// missed here. STENCIL_PATH is pinned separately above -- SHAPES_PATH
// (the JS painter bundles) and everything else here stays fail-closed.
const LOCAL_ONLY_PATHS = [
  'mxBasePath', 'mxImageBasePath', 'SHAPES_PATH', 'STYLE_PATH', 'PROXY_URL',
  'DRAWIO_BASE_URL', 'DRAW_MATH_URL', 'DRAWIO_LIGHTBOX_URL', 'GRAPH_IMAGE_PATH', 'EXPORT_URL',
  'NOTIFICATIONS_URL', 'DRAWIO_GITHUB_API_URL', 'DRAWIO_GITHUB_URL', 'DRAWIO_GITLAB_URL',
  'SAVE_URL', 'OPEN_URL', 'CSS_PATH', 'IMAGE_PATH', 'RESOURCES_PATH', 'TEMPLATE_PATH',
  'NEW_DIAGRAM_CATS_PATH',
]

function pinLocalOnly() {
  const w = window as unknown as Record<string, string>
  w.STENCIL_PATH ??= STENCIL_PATH
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
    let viewer: DrawioViewerInstance | null = null
    // 'pages' is the viewer's own prev/next page selector (goal 0259):
    // it renders ahead of the zoom cluster only when the file has more
    // than one page (the viewer hides it otherwise), so a multi-page
    // diagram's pages are reachable right on the rendered face without
    // opening the editor.
    host.setAttribute('data-mxgraph', JSON.stringify({ xml, resize: true, toolbar: 'pages zoom', editable: false, lightbox: false }))
    loadDrawioViewer()
      .then((GraphViewer) => {
        if (cancelled) return
        try {
          GraphViewer.createViewerForElement(host, (instance) => {
            viewer = instance
            // body defaults --wails-draggable:drag (drag the native window
            // by its background) and the runtime reads that property off
            // the EVENT TARGET's computed style (@wailsio/runtime drag.js).
            // The toolbar lives under body, so the host's own no-drag
            // never reaches it and holding a zoom/page button dragged
            // the whole app window (goal 0292). Opt the element out
            // directly; the custom property inherits to its buttons.
            instance.toolbar?.style.setProperty('--wails-draggable', 'no-drag')
          })
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      // The viewer only detaches its body-appended toolbar on a later
      // pointer leave; a host unmounted while hovered would leave it
      // orphaned over the board.
      viewer?.toolbar?.remove()
      host.innerHTML = ''
      host.removeAttribute('data-mxgraph')
    }
  }, [ref, xml])

  return error
}
