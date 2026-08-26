import { lazy } from 'react'
import { registerBoardObjectContent } from '../atlasNounRegistry'

// Lazy-imported (React.lazy + Suspense, AtlasBoardObjectNode.tsx's own
// boundary) rather than a static top-level import: AtlasSheetObjectContent
// pulls @primer/react's Text/Stack/Button plus the xlsx/csv parser
// libraries (dynamically imported again, one level deeper, inside the
// component itself), and this module is eagerly glob-imported by
// atlasTools.ts -- a static import here would drag all of that into
// every pure-logic import graph that reaches ATLAS_TOOLS, not only the
// real board render path that actually needs it.
const AtlasSheetObjectContent = lazy(() => import('../AtlasSheetObjectContent').then((m) => ({ default: m.AtlasSheetObjectContent })))

// sheet (goal 0232 S2): the honest home for a tool-less noun, the same
// shape diagramNoun.ts already established -- sheet lands by native
// file-drop only (.xlsx/.csv), no tray button, no identity in
// shared/atlasToolIdentity.ts, no gesture, so it has no AtlasToolShape
// to satisfy and calls the board-object content registry directly.
registerBoardObjectContent('sheet', {
  Component: AtlasSheetObjectContent,
  ariaLabelKey: 'boardObject.sheetAriaLabel',
  // Unlike diagram/image (role: 'img', an opaque render with nothing to
  // navigate into), a sheet preview renders a real <table> a screen
  // reader should read cell-by-cell -- img's ARIA role would flatten
  // that structure away. Matches table's own role: undefined, but for
  // the opposite reason table declares it (real interactive
  // descendants there; here, real non-interactive tabular structure).
  role: undefined,
  // The grid scrolls internally past its natural size -- the shared
  // chrome band is its drag surface, same as table/diagram.
  dragBand: true,
  // Payload.mirrorPath names the real .xlsx/.csv file this content
  // renders (goal 0232 S1's contract) -- the shared watch subscription
  // and "Open in default app" enablement both key off this flag.
  fileBacked: true,
})
