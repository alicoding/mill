import { FileIcon, ImageIcon, NoteIcon, SquareIcon, TableIcon } from '@primer/octicons-react'
import type { Icon } from '@primer/octicons-react'
import { Type as FieldType, type Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService, ConfigureService } from '../shared/bindings'
import { ATLAS_TOOL_IDENTITIES, type AtlasToolIdentity } from '../shared/atlasToolIdentity'
import { fileToBase64 } from '../shared/base64Blob'
import { lastUsedKindID, normalizeLocalPathInput, titleFromFilename } from './atlasCreateHelpers'

// The canvas tool registry (goal 0169 slice 1): every creatable
// thing's own descriptor, in tray render order -- AtlasCreationTray,
// commands.ts, and useKeymapDispatch all derive their per-tool
// behaviour from this array rather than holding a parallel list of
// their own. id/shortcutKey/label come from shared/atlasToolIdentity.ts
// (the cross-layer seed shared/commands.ts also reads, since shared/
// can never import this atlas/ module).

// The full interaction vocabulary the canvas tool set spans (goal
// 0169); slice 2 adds the third (paste-or-drop). A tool needing a
// SEVENTH shape is a signal this discriminant is wrong, not a reason
// to add a bypass.
export type AtlasToolInteraction =
  | 'arm-then-click'
  | 'pick-then-place'
  | 'drag-to-draw'
  | 'drag-to-erase'
  | 'ephemeral-drag'
  | 'paste-or-drop'

// Session-only cache seeding a newly created object's own style
// (colour/size, ...) -- never persisted document data. Unused until a
// styled tool ships (slice S3).
export type AtlasToolStyleDefaults = Record<string, unknown>

interface AtlasToolShape {
  id: string
  icon: Icon
  label: string
  shortcutKey: string | null
  tray: 'quick' | 'palette'
  interaction: AtlasToolInteraction
  styleDefaults?: AtlasToolStyleDefaults
  // Each concrete tool's own commit signature differs (a card commits
  // kind+title, a table mints a backing List); this base only has to
  // accept every one of them for the array's own element type to work,
  // never call through it generically.
  commit: (input: never) => unknown
}

function identityOf<ID extends AtlasToolIdentity['id']>(id: ID): Extract<AtlasToolIdentity, { id: ID }> {
  const found = ATLAS_TOOL_IDENTITIES.find((t): t is Extract<AtlasToolIdentity, { id: ID }> => t.id === id)
  if (!found) throw new Error(`no atlas tool identity registered for "${id}"`)
  return found
}

export interface AtlasCardArtifact { kind: 'card'; kindID: string; title: string; note: string }
export interface AtlasNoteArtifact { kind: 'note'; text: string }
export interface AtlasAreaArtifact { kind: 'area'; kindID: string; title: string; enclosedCardIDs: string[]; enclosedNoteIDs: string[] }
export interface AtlasTableArtifact { kind: 'table'; title: string; listID: string }
export interface AtlasImageArtifact { kind: 'image'; title: string; mirrorPath: string }

const cardIdentity = identityOf('card')
const noteIdentity = identityOf('note')
const areaIdentity = identityOf('area')
const tableIdentity = identityOf('table')
const imageIdentity = identityOf('image')

// Card's instant-placement default (goal 0144: the click IS the
// creation, no form) resolves the last-used kind itself; a form-driven
// create (right-click "Add card", paste, slot-link) instead supplies
// kindID/title explicitly and this just shapes them into the same
// artifact -- one function backs both placement doors.
const cardTool = {
  id: cardIdentity.id,
  icon: FileIcon,
  label: cardIdentity.commandLabel,
  shortcutKey: cardIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'arm-then-click',
  commit: (input: { kinds: Kind[]; kindID?: string; title?: string; note?: string }): AtlasCardArtifact => ({
    kind: 'card',
    kindID: input.kindID ?? lastUsedKindID(input.kinds),
    title: input.title ?? 'Untitled',
    note: input.note ?? '',
  }),
} as const satisfies AtlasToolShape

const noteTool = {
  id: noteIdentity.id,
  icon: NoteIcon,
  label: noteIdentity.commandLabel,
  shortcutKey: noteIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'arm-then-click',
  commit: (input: { text: string }): AtlasNoteArtifact => ({ kind: 'note', text: input.text.trim() }),
} as const satisfies AtlasToolShape

const areaTool = {
  id: areaIdentity.id,
  icon: SquareIcon,
  label: areaIdentity.commandLabel,
  shortcutKey: areaIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'arm-then-click',
  commit: (input: { kindID: string; title: string; enclosedCardIDs: string[]; enclosedNoteIDs: string[] }): AtlasAreaArtifact => ({
    kind: 'area',
    kindID: input.kindID,
    title: input.title,
    enclosedCardIDs: input.enclosedCardIDs,
    enclosedNoteIDs: input.enclosedNoteIDs,
  }),
} as const satisfies AtlasToolShape

// Table's own artifact is the backing List it mints (goal 0169's seam
// with 0133): the projection card that actually lands on the board is
// the placement path's job, minting the List behind it is this tool's.
const tableTool = {
  id: tableIdentity.id,
  icon: TableIcon,
  label: tableIdentity.commandLabel,
  shortcutKey: tableIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'pick-then-place',
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

// Kept identical to atlas/mirror.go's imageMimeTypes allow-list, in the
// reverse direction -- a pasted File's own `.type` names the ONE mime
// value browsers give it, so this only needs the extensions Mill's
// image renderer actually recognizes, same "kept identical" discipline
// atlasUnitMirror.ts's own IMAGE_EXTENSIONS comment already documents.
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
}

// Image (goal 0169 slice 2): the paste-or-drop interaction's own proof.
// Two input shapes resolve to the same artifact -- a typed/pasted local
// path is mirror-only (no bytes ever move, matching
// CreateCardFromFileDrop's own native-drop semantics); a pasted
// clipboard File has no path at all, so its bytes are written to a
// fresh Mill-owned file first (SaveImageBytes) and ITS path becomes the
// mirror. Either way, placement (useAtlasImageCreate.ts) lands the
// resulting mirrorPath through the exact same CreateCardFromFileDrop a
// native OS file drop already uses -- kind resolution and duplicate
// detection are never re-implemented here.
const imageTool = {
  id: imageIdentity.id,
  icon: ImageIcon,
  label: imageIdentity.commandLabel,
  shortcutKey: imageIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'paste-or-drop',
  commit: async (input: { path: string } | { file: File; title: string }): Promise<AtlasImageArtifact> => {
    if ('file' in input) {
      const ext = IMAGE_MIME_EXTENSIONS[input.file.type]
      if (!ext) throw new Error(`unsupported pasted image type: ${input.file.type}`)
      const base64 = await fileToBase64(input.file)
      const mirrorPath = await AtlasService.SaveImageBytes(base64, ext, input.title)
      return { kind: 'image', title: input.title, mirrorPath }
    }
    const mirrorPath = normalizeLocalPathInput(input.path)
    return { kind: 'image', title: titleFromFilename(mirrorPath), mirrorPath }
  },
} as const satisfies AtlasToolShape

export { cardTool, noteTool, areaTool, tableTool, imageTool }

export const ATLAS_TOOLS = [cardTool, noteTool, areaTool, tableTool, imageTool] as const

export type AtlasToolID = (typeof ATLAS_TOOLS)[number]['id']

// The narrower id set for tools whose tray gesture is click-to-arm
// (Card/Note/Area) -- Table's own arming (a picked size) never goes
// through the same armedTool state, so it's excluded here exactly as
// it always has been.
export type AtlasCreationTool = Extract<(typeof ATLAS_TOOLS)[number], { interaction: 'arm-then-click' }>['id']
