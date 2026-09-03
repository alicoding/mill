import { lazy } from 'react'
import { FileIcon } from '@primer/octicons-react'
import { registerBoardObjectContent } from '../atlasNounRegistry'

// Lazy-imported for the same reason sheetNoun.ts documents: this
// module is eagerly glob-imported by atlasTools.ts, and the face pulls
// @primer/react chrome that must stay out of pure-logic import graphs.
const AtlasPdfObjectContent = lazy(() => import('../extensions/AtlasPdfObjectContent').then((m) => ({ default: m.AtlasPdfObjectContent })))

// pdf (goal 0267): a tool-less, file-drop/paste-only noun, the same
// shape diagramNoun.ts/sheetNoun.ts established -- no tray button, no
// AtlasToolShape; a dropped or pasted .pdf lands as this object and
// renders through the vendored pdf.js viewer (Mozilla's own prebuilt
// web viewer under public/vendor/pdfjs -- Apache-2.0, fully local, the
// wasm codecs are prebuilt blobs so no cargo/Rust enters Mill's build,
// SPEC §1.1's stated carve-out).
registerBoardObjectContent('pdf', {
  Component: AtlasPdfObjectContent,
  ariaLabelKey: 'boardObject.pdfAriaLabel',
  // The viewer is a real interactive document app (paging, selection,
  // search), not an opaque render -- same reasoning sheet gives for
  // declining img.
  role: undefined,
  // The viewer's iframe captures every pointer event -- the shared
  // chrome band is this Kind's only drag surface, same as
  // table/diagram/sheet.
  dragBand: true,
  clickShield: true,
  wheelContained: true,
  // Payload.mirrorPath names the real .pdf file (goal 0232 S1's
  // contract): shared watch + "Open in default app" enablement.
  fileBacked: true,
  source: { kind: 'file', pathKey: 'mirrorPath' },
  editRoute: { kind: 'external-app' },
  extension: {
    icon: FileIcon,
    label: 'PDF',
    description: 'View PDF documents dropped onto the board, pages and all.',
    disableScopeNote: 'Turning this off stops new PDFs from landing on drop. PDFs already on the board keep working, including opening in your default app.',
    group: 'file',
  },
})
