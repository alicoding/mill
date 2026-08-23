import { FileIcon, ImageIcon, NoteIcon, PencilIcon, SquareIcon, TableIcon, TrashIcon, ZapIcon } from '@primer/octicons-react'
import type { Icon } from '@primer/octicons-react'
import { Type as FieldType, type Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService, ConfigureService } from '../shared/bindings'
import { ATLAS_TOOL_IDENTITIES, type AtlasToolIdentity } from '../shared/atlasToolIdentity'
import { fileToBase64 } from '../shared/base64Blob'
import { lastUsedKindID, normalizeLocalPathInput, titleFromFilename } from './atlasCreateHelpers'
import { buildPencilStrokeSvg, svgToBase64, type PencilPoint } from './atlasPencilSvg'

// The canvas tool registry (goal 0169 slice 1): every creatable
// thing's own descriptor, in tray render order -- AtlasCreationTray,
// commands.ts, and useKeymapDispatch all derive their per-tool
// behaviour from this array rather than holding a parallel list of
// their own. id/shortcutKey/label come from shared/atlasToolIdentity.ts
// (the cross-layer seed shared/commands.ts also reads, since shared/
// can never import this atlas/ module).

// The full interaction vocabulary the canvas tool set spans (goal
// 0169); slice 2 added the third (paste-or-drop), slice 3 put the
// fourth (drag-to-draw) into real use, slice 4 puts the fifth and
// sixth (drag-to-erase, ephemeral-drag) into use -- every shape this
// discriminant was originally sized to now has a real tool. A tool
// needing a SEVENTH shape is a signal this discriminant is wrong, not
// a reason to add a bypass.
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
// The stroke's own bounding-box origin (atlasPencilSvg.ts's own
// PencilStrokeSvg.originX/Y) rides along on the artifact so the
// placement door (useAtlasPencilCreate.ts) can convert exactly that
// point through screenToFlowPosition -- the card lands where the
// stroke was drawn, not at an arbitrary free slot.
export interface AtlasPencilArtifact { kind: 'pencil'; title: string; mirrorPath: string; originX: number; originY: number }

const cardIdentity = identityOf('card')
const noteIdentity = identityOf('note')
const areaIdentity = identityOf('area')
const tableIdentity = identityOf('table')
const imageIdentity = identityOf('image')
const pencilIdentity = identityOf('pencil')
const eraserIdentity = identityOf('eraser')
const laserIdentity = identityOf('laser')

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

// Pencil (goal 0169 slice 3): the drag-to-draw interaction's own
// proof, and the styleDefaults dual model's real test. size/color are
// SESSION defaults (atlasPencilStyleStore.ts, never persisted) that
// seed a stroke's own commit -- once drawn, colour/size are baked into
// the stroke's SVG bytes below, which IS persisted document data
// (the created card's own MirrorPath file), never re-read from the
// ephemeral cache again.
const PENCIL_DEFAULT_STYLE: AtlasToolStyleDefaults = { color: '#1f6feb', size: 4 }

const pencilTool = {
  id: pencilIdentity.id,
  icon: PencilIcon,
  label: pencilIdentity.commandLabel,
  shortcutKey: pencilIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'drag-to-draw',
  styleDefaults: PENCIL_DEFAULT_STYLE,
  commit: async (input: { points: PencilPoint[]; color: string; size: number }): Promise<AtlasPencilArtifact | null> => {
    const doc = buildPencilStrokeSvg(input.points, input.color, input.size)
    if (!doc) return null
    const mirrorPath = await AtlasService.SaveImageBytes(svgToBase64(doc.svg), '.svg', 'Sketch')
    return { kind: 'pencil', title: 'Sketch', mirrorPath, originX: doc.originX, originY: doc.originY }
  },
} as const satisfies AtlasToolShape

// Eraser (goal 0169 slice 4): drag-to-erase's own proof. Whole-element
// only -- never a partial/pixel erase (the converged default this
// goal's own research recorded: pixel-erase is contested even
// upstream). Deletion is NOT unrecoverable: it never calls
// AtlasService directly at all -- useAtlasEraserDraw.ts hands its
// accumulated hit set straight to the SAME onDeleteSelection door the
// selection tray's own Delete key already uses (AtlasBoard.tsx), which
// routes through goal 0093's quick-delete-WITH-UNDO guard (a 10s toast
// + Cmd-Z, AtlasUndoToast.tsx) -- the exact mechanism every other
// Atlas delete already relies on, never a bespoke one. Scoped to
// TOP-LEVEL boxes only, same as every other spatial gesture on this
// board (area-draw, drag-filing, slot-drag) -- a card nested inside a
// frame's own preview isn't independently erasable by a drag over that
// preview. Containers (isFrame boxes) are excluded from the hit test
// entirely: a frame's own rendered bounds cover its whole child area,
// so treating it as touchable would make erasing something INSIDE a
// frame risk sweeping the frame itself away too -- the highest-blast-
// radius accident this tool could cause. Deleting a container stays a
// deliberate act (the frame's own Delete/Dissolve menu item).
// commit() below is never called -- this tool bypasses the "commit
// produces an artifact for placement" model entirely, since erasing
// destroys board state rather than creating any; it exists only to
// satisfy AtlasToolShape's own required shape.
const eraserTool = {
  id: eraserIdentity.id,
  icon: TrashIcon,
  label: eraserIdentity.commandLabel,
  shortcutKey: eraserIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'drag-to-erase',
  commit: (): null => null,
} as const satisfies AtlasToolShape

// Laser (goal 0169 slice 4): ephemeral-drag's own proof -- a pointer
// trail for pointing at things while talking. Renders from LOCAL
// component state only (useAtlasLaserDraw.ts), the same ephemeral-
// overlay pattern AtlasPencilLivePreview.tsx already established, and
// makes NO AtlasService call at any point in its lifecycle: nothing is
// ever created, so there is nothing to place and nothing for a reload
// to read back. commit() below is never called, for the same reason
// eraserTool's isn't -- kept only to satisfy AtlasToolShape's shape.
const laserTool = {
  id: laserIdentity.id,
  icon: ZapIcon,
  label: laserIdentity.commandLabel,
  shortcutKey: laserIdentity.shortcutKey,
  tray: 'quick',
  interaction: 'ephemeral-drag',
  commit: (): null => null,
} as const satisfies AtlasToolShape

export { cardTool, noteTool, areaTool, tableTool, imageTool, pencilTool, eraserTool, laserTool }

export const ATLAS_TOOLS = [cardTool, noteTool, areaTool, tableTool, imageTool, pencilTool, eraserTool, laserTool] as const

export type AtlasToolID = (typeof ATLAS_TOOLS)[number]['id']

// The narrower id set for tools whose tray gesture is click-to-arm
// (Card/Note/Area) -- Table's own arming (a picked size) never goes
// through the same armedTool state, so it's excluded here exactly as
// it always has been.
export type AtlasCreationTool = Extract<(typeof ATLAS_TOOLS)[number], { interaction: 'arm-then-click' }>['id']

// The wider id set for every tool whose tray gesture ARMS a placement
// state at all -- arm-then-click's single-click tools plus every other
// click-to-arm-then-drag tool (pencil, eraser, laser). AtlasBoard.tsx's
// creation.armedTool is typed this wide so any of them can be the live
// armedTool value without widening AtlasCreationTool itself and
// disturbing every arm-then-click-only caller (placeAt's own
// single-click placement, which none of these three ever go through).
export type AtlasArmableTool = Extract<(typeof ATLAS_TOOLS)[number], { interaction: 'arm-then-click' | 'drag-to-draw' | 'drag-to-erase' | 'ephemeral-drag' }>['id']
