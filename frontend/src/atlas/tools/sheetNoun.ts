import { lazy } from 'react'
import { ColumnsIcon } from '@primer/octicons-react'
import { registerBoardObjectContent } from '../atlasNounRegistry'
import { SHEET_MAX_COLS, SHEET_MAX_ROWS } from '../atlasSheetTruncate'

// Lazy-imported (React.lazy + Suspense, AtlasBoardObjectNode.tsx's own
// boundary) rather than a static top-level import: AtlasSheetObjectContent
// pulls @primer/react's Text/Stack/Button plus the xlsx/csv parser
// libraries (dynamically imported again, one level deeper, inside the
// component itself), and this module is eagerly glob-imported by
// atlasTools.ts -- a static import here would drag all of that into
// every pure-logic import graph that reaches ATLAS_TOOLS, not only the
// real board render path that actually needs it.
const AtlasSheetObjectContent = lazy(() => import('../extensions/AtlasSheetObjectContent').then((m) => ({ default: m.AtlasSheetObjectContent })))

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
  // ADR-0046 (goal 0244 S0): sheet is this slice's proof object -- its
  // own "Open in default app" button (AtlasSheetObjectContent.tsx) now
  // reads editRoute back off this declaration and calls
  // dispatchObjectEdit (objectSeams.ts) instead of AtlasService
  // directly.
  source: { kind: 'file', pathKey: 'mirrorPath' },
  editRoute: { kind: 'external-app' },
  // extension (goal 0237 S3 rider): the Settings > Extensions row for
  // this tool-less noun. disableScopeNote states its scope honestly --
  // there is no tray button to hide and no embedded editor to close
  // (editRoute above is a static 'external-app', which dispatchObjectEdit
  // never gates), so the toggle only affects
  // useAtlasNativeFileDrop.ts's own routing.
  extension: {
    icon: ColumnsIcon,
    label: 'atlas:sheetNoun.name',
    description: 'atlas:sheetNoun.description',
    disableScopeNote: 'atlas:sheetNoun.disableScopeNote',
    // File-drop-only, the same Media family Image's own group names
    // (atlasNounRegistry.ts's AtlasNounGroup) -- the dock's Media
    // flyout reaches it through "From file…", never a button of its own.
    group: 'media',
    // The preview caps (goal 0258 slice 1's number consumer): the
    // parameters truncateSheetRows already takes, read by
    // AtlasSheetObjectContent.tsx per render. The defaults restate
    // atlasSheetTruncate.ts's own constants.
    settings: [
      {
        type: 'number',
        key: 'previewRows',
        label: 'atlas:sheetNoun.settings.previewRows.label',
        description: 'atlas:sheetNoun.settings.previewRows.description',
        defaultValue: SHEET_MAX_ROWS,
        min: 1,
        max: 500,
      },
      {
        type: 'number',
        key: 'previewCols',
        label: 'atlas:sheetNoun.settings.previewCols.label',
        description: 'atlas:sheetNoun.settings.previewCols.description',
        defaultValue: SHEET_MAX_COLS,
        min: 1,
        max: 100,
      },
    ],
  },
})
