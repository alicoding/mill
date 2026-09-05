import { lazy } from 'react'
import { FlowchartIcon } from '@primer/octicons-react'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { registerBoardObjectContent } from '../atlasNounRegistry'
import { isDrawioEditableExtension } from '../atlasDiagramMirror'

// Lazy-imported (React.lazy + Suspense, AtlasBoardObjectNode.tsx's own
// boundary) rather than a static top-level import: AtlasDiagramObjectContent
// pulls @primer/react's Text, and this module is eagerly glob-imported
// by atlasTools.ts -- a static import here would drag that dependency
// into every pure-logic import graph that reaches ATLAS_TOOLS, not only
// the real board render path that actually needs it.
const AtlasDiagramObjectContent = lazy(() => import('../extensions/AtlasDiagramObjectContent').then((m) => ({ default: m.AtlasDiagramObjectContent })))

// diagram (goal 0179 S2, goal 0215 S3): the honest home for a
// tool-less noun. Diagram lands by native file-drop only -- no tray
// button, no identity in shared/atlasToolIdentity.ts, no gesture -- so
// it has no AtlasToolShape to satisfy at all and calls the board-object
// content registry directly rather than through registerNoun(). Kept
// in tools/ (glob-discovered by atlasTools.ts's own
// import.meta.glob) purely so this call runs at the same module-eval
// time every other noun's registration does; it is deliberately NOT a
// registerNoun() call and carries no id, icon, or tray field.
registerBoardObjectContent('diagram', {
  Component: AtlasDiagramObjectContent,
  ariaLabelKey: 'boardObject.diagramAriaLabel',
  role: 'img',
  // A diagram's own vendored pan/zoom viewer captures pointer events --
  // the shared chrome band is its only drag surface, same as table's.
  dragBand: true,
  // The vendored viewer pans and zooms on its own (goal 0354): idle, a
  // transparent shield takes the first click and every wheel goes to
  // the board (pan, pinch and ⌘-scroll zoom, like over any object);
  // selected, the viewer owns the wheel and the frame opts the board
  // out.
  input: 'interactive',
  shieldHintKey: 'atlas:diagramNoun.shieldHint',
  // overflowChip (goal 0340): a drawing is routinely larger than the
  // box it sits in, and the face can fit it -- so the shared chrome
  // band carries a "Fit" chip whenever the viewer reports it currently
  // overflows.
  overflowChip: true,
  // pager (goal 0354): a .drawio file may carry several pages, and the
  // board object shows no vendored toolbar to page them with -- so the
  // shared chrome band carries the indicator and its own previous/next
  // controls whenever the face reports more than one page.
  pager: true,
  // Payload.mirrorPath names the real drawio/mermaid file this content
  // renders (goal 0232 S1) -- AtlasBoardObjectNode.tsx's own shared
  // watch subscription and useAtlasObjectMenu.ts's "Open in default
  // app" enablement both key off this flag.
  fileBacked: true,
  source: { kind: 'file', pathKey: 'mirrorPath' },
  // ADR-0046 (goal 0244 S1): a per-object RESOLVER, not a static route
  // -- diagram is the one Kind whose door genuinely differs by its own
  // artifact. A .drawio mirror opens the real embedded editor; a
  // .mmd/.mermaid one has none (ADR-0045's own honest finding), so it
  // resolves to external-app instead. AtlasBoardObjectNode.tsx's own
  // double-click gate and objectSeams.ts's dispatchObjectEdit both read
  // this resolver back rather than re-deriving the extension check.
  editRoute: (object: BoardObject) => (
    isDrawioEditableExtension(object.Payload?.mirrorPath ?? '')
      ? { kind: 'embedded-engine', engine: 'drawio' }
      : { kind: 'external-app' }
  ),
  // extension (goal 0237 S3 rider): the Settings > Extensions row for
  // this tool-less noun. disableScopeNote states its scope honestly --
  // there is no tray button to hide, so the toggle instead gates
  // useAtlasNativeFileDrop.ts's own routing (a disabled drop falls
  // through to the plain card path) and dispatchObjectEdit's
  // embedded-engine arm (objectSeams.ts, already keyed off object.Kind).
  extension: {
    icon: FlowchartIcon,
    label: 'atlas:diagramNoun.name',
    description: 'atlas:diagramNoun.description',
    disableScopeNote: 'atlas:diagramNoun.disableScopeNote',
    // File-drop-only, the same family Image's own 'file' group already
    // names (atlasNounRegistry.ts's AtlasNounGroup).
    group: 'file',
  },
})
