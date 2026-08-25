import { TableIcon } from '@primer/octicons-react'
import { Type as FieldType, type Field } from '../../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { ConfigureService } from '../../shared/bindings'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'

const tableIdentity = identityOf('table')

export interface AtlasTableArtifact { kind: 'table'; title: string; listID: string }

// Table's own artifact is the backing List it mints (goal 0169's seam
// with 0133): the projection card that actually lands on the board is
// the placement path's job, minting the List behind it is this tool's.
export const tableTool = {
  id: tableIdentity.id,
  icon: TableIcon,
  label: tableIdentity.commandLabel,
  shortcutKey: tableIdentity.shortcutKey,
  tray: 'quick',
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
