import { lazy } from 'react'
import { FileCodeIcon } from '@primer/octicons-react'
import { registerBoardObjectContent } from '../atlasNounRegistry'

// Lazy-imported for the same reason sheetNoun.ts documents: this
// module is eagerly glob-imported by atlasTools.ts, and the face pulls
// @primer/react chrome plus the yaml parser that must stay out of
// every pure-logic import graph.
const AtlasJsonObjectContent = lazy(() => import('../extensions/AtlasJsonObjectContent').then((m) => ({ default: m.AtlasJsonObjectContent })))

// json (goal 0269): a tool-less, file-drop-only noun, the same shape
// diagramNoun.ts/sheetNoun.ts/pdfNoun.ts established -- a dropped
// .json/.yaml/.yml file lands as this object and renders as an
// indented, collapsible TREE (the form seven of the eight researched
// inspectors show a document in), never a node-and-edge graph. No VALUE
// is editable in the face: "Open in default app" is the editor, and the
// tree is structure over the same text.
registerBoardObjectContent('json', {
  Component: AtlasJsonObjectContent,
  ariaLabelKey: 'boardObject.jsonAriaLabel',
  // A tree is real navigable structure a screen reader reads row by
  // row (TreeView's own treeitem semantics), not an opaque render --
  // same reasoning sheet gives for declining img.
  role: undefined,
  // The tree scrolls internally past its natural size and its rows
  // consume clicks (expand, focus, the row menu) -- the shared chrome
  // band is this Kind's drag surface, same as table/diagram/sheet/pdf.
  dragBand: true,
  // The tree scrolls in both axes, its rows take focus and its filter
  // input takes typing (goal 0354), so the object is selected before
  // any of that is reachable -- object first, row second, the same
  // rule the table and sheet grids follow. Every canvas opt-out the
  // frame applies is derived from this one fact.
  content: 'interactive',
  shieldHintKey: 'atlas:jsonNoun.shieldHint',
  // Payload.mirrorPath names the real file (goal 0232 S1's contract):
  // shared watch + "Open in default app" enablement.
  fileBacked: true,
  source: { kind: 'file', pathKey: 'mirrorPath' },
  editRoute: { kind: 'external-app' },
  extension: {
    icon: FileCodeIcon,
    label: 'atlas:jsonNoun.name',
    description: 'atlas:jsonNoun.description',
    disableScopeNote: 'atlas:jsonNoun.disableScopeNote',
    group: 'file',
  },
})
