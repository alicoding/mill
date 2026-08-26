import { lazy } from 'react'
import { registerBoardObjectContent } from '../atlasNounRegistry'

// Lazy-imported (React.lazy + Suspense, AtlasBoardObjectNode.tsx's own
// boundary) rather than a static top-level import: AtlasDiagramObjectContent
// pulls @primer/react's Text, and this module is eagerly glob-imported
// by atlasTools.ts -- a static import here would drag that dependency
// into every pure-logic import graph that reaches ATLAS_TOOLS, not only
// the real board render path that actually needs it.
const AtlasDiagramObjectContent = lazy(() => import('../AtlasDiagramObjectContent').then((m) => ({ default: m.AtlasDiagramObjectContent })))

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
  // Payload.mirrorPath names the real drawio/mermaid file this content
  // renders (goal 0232 S1) -- AtlasBoardObjectNode.tsx's own shared
  // watch subscription and useAtlasObjectMenu.ts's "Open in default
  // app" enablement both key off this flag.
  fileBacked: true,
})
