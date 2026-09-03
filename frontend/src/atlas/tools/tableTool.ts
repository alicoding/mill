import { lazy } from 'react'
import { TableIcon } from '@primer/octicons-react'
import { Type as FieldType, type Field } from '../../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { ConfigureService } from '../../shared/bindings'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'

// Lazy-imported (React.lazy + Suspense, AtlasBoardObjectNode.tsx's own
// boundary) rather than a static top-level import: AtlasTableObjectContent
// pulls @primer/react's Text through AtlasCardProjectionTable, and this
// module is eagerly glob-imported by atlasTools.ts -- a static import
// here would drag that dependency into every pure-logic import graph
// that reaches ATLAS_TOOLS (atlasTools.test.ts among them), not only
// the real board render path that actually needs it.
const AtlasTableObjectContent = lazy(() => import('../extensions/AtlasTableObjectContent').then((m) => ({ default: m.AtlasTableObjectContent })))

const tableIdentity = identityOf('table')

export interface AtlasTableArtifact { kind: 'table'; title: string; listID: string }

// Table's own artifact is the backing List it mints (goal 0169's seam
// with 0133): the projection card that actually lands on the board is
// the placement path's job, minting the List behind it is this tool's.
export const tableTool = {
  id: tableIdentity.id,
  icon: TableIcon,
  label: tableIdentity.commandLabel,
  nounName: 'Table',
  description: 'Adds a live table backed by a Configure List.',
  shortcutKey: tableIdentity.shortcutKey,
  tray: 'quick',
  // A live view of List data -- typed, queryable (goal 0224's
  // disposition table), tray-primary.
  group: 'knowledge',
  interaction: tableIdentity.interaction,
  // Arms through the size-picker popover, never the toggleArm/lock
  // state machine -- always false, not N/A (atlasNounRegistry.ts's own
  // header comment on this field).
  lockable: false,
  // Rendered via the shared 'atlas-object' board renderer
  // (AtlasBoardObjectNode), whose NodeResizer + drag frame band cover
  // every Kind that routes through it (goal 0199's #404/#405).
  resizable: true,
  boardNodeType: 'atlas-object',
  // A table's own grid captures pointer events (nodrag) -- the band is
  // its ONLY drag surface (goal 0206's own DESIGN DECIDED table).
  dragBand: true,
  // A table projects a Configure List, not a file on disk -- never
  // fileBacked (goal 0232 S1).
  fileBacked: false,
  boardObjectKind: 'table',
  // No role="img" (unlike every other content contribution): a table's
  // own grid carries REAL interactive descendants (editable cells,
  // boundary-insert buttons) -- img's own ARIA semantics forbid
  // meaningful children.
  content: {
    Component: AtlasTableObjectContent,
    ariaLabelKey: 'boardObject.tableAriaLabel',
    role: undefined,
    // ADR-0046 (goal 0244 S0): Payload.listID names the backing
    // Configure List this Kind projects -- a provider source, not a
    // file.
    source: { kind: 'provider', refKey: 'listID' },
    // inline (goal 0244 S2, ADR-0046's edit law -- the Sheets/Notion/
    // Airtable precedent): a cell edit writes the backing List entity
    // directly, never a parallel copy. The well's own content
    // (AtlasTableObjectContent -> AtlasCardProjectionTable ->
    // shared/ListGrid) already owns click-to-edit end to end and calls
    // ConfigureService.UpdateListRow itself -- the SAME write door
    // Configure's own List page uses, so a table object's edit and
    // Configure's edit are the one List, never two. This is why
    // dispatchObjectEdit's own 'inline' arm stays a no-op host-level
    // door AND AtlasBoardObjectNode's double-click gate never fires for
    // it (editable = editRoute.kind === 'embedded-engine' only): inline
    // editing is a click INSIDE the well, not a door the host opens.
    editRoute: { kind: 'inline' },
  },
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Arms through the size-picker popover, never the drag gesture
  // engine -- always false/null, not N/A.
  sticky: false,
  gesture: null,
  commit: async (input: { cols: number; rowCount: number; existingTitles: Set<string> }): Promise<AtlasTableArtifact> => {
    let title = 'Table'
    for (let n = 2; input.existingTitles.has(title); n++) title = `Table ${n}`
    const columns: Field[] = Array.from({ length: input.cols }, (_, i): Field => ({
      Key: `column-${i + 1}`, Label: `Column ${i + 1}`, Type: FieldType.TypeText,
      Required: false, Default: '', Description: '', Options: null,
      Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
    }))
    const created = await ConfigureService.CreateList(title, '', columns)
    for (let i = 0; i < input.rowCount; i++) await ConfigureService.AddListRow(created.ID, {})
    return { kind: 'table', title, listID: created.ID }
  },
} as const satisfies AtlasToolShape

registerNoun(tableTool)
