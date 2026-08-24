// The atlas creation tools' cross-layer identity: id, bare shortcut
// key, command-palette label, which uiSignalStore request a bare
// keypress fires, and the authoring gesture shape (interaction). Lives
// here rather than in atlas/tools/*.ts (each noun's own self-registered
// descriptor -- goal 0180 S1's registry, mirroring
// internal/domain/composition/registry.go's RegisterNodeType/ADR-0006)
// because shared/ can never import atlas/ (dependency-cruiser's
// shared-is-a-leaf rule), while shared/commands.ts still needs each
// tool's id/shortcutKey/label to generate its own Command.
//
// `interaction` sits here, not only on each noun's own runtime
// descriptor, because AtlasCreationTool/AtlasArmableTool
// (atlas/atlasTools.ts) are COMPILE-TIME literal unions keyed on it --
// import.meta.glob's discovered modules type as Record<string,
// unknown>, so TypeScript cannot derive a literal union from them.
// Deriving those two types from this array's own still-literal
// AtlasToolIdentity union is what keeps them real unions instead of
// collapsing to `string` (see atlasTools.ts's own header comment for
// the full trap). Each noun's registered descriptor still carries its
// own `interaction` too (AtlasToolShape.interaction) for runtime
// branching (AtlasCreationTray, AtlasBoard's gesture routing); the
// registry's own agreement check cross-validates the two never
// silently drift apart.
export type AtlasToolRequestKind = 'arm' | 'picker' | 'popover'

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

// Nine distinct members, not one member with a unioned id -- so that
// Extract<AtlasToolIdentity, { id: 'card' }> (each noun module's own
// lookup) can actually narrow to a single one.
export type AtlasToolIdentity =
  | { id: 'card'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'arm-then-click' }
  | { id: 'note'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'arm-then-click' }
  | { id: 'area'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'arm-then-click' }
  | { id: 'table'; shortcutKey: string; commandLabel: string; requestKind: 'picker'; interaction: 'pick-then-place' }
  | { id: 'image'; shortcutKey: string; commandLabel: string; requestKind: 'popover'; interaction: 'paste-or-drop' }
  | { id: 'pencil'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'drag-to-draw' }
  | { id: 'eraser'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'drag-to-erase' }
  | { id: 'laser'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'ephemeral-drag' }
  | { id: 'shape'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'drag-to-draw' }

export const ATLAS_TOOL_IDENTITIES: AtlasToolIdentity[] = [
  { id: 'card', shortcutKey: 'C', commandLabel: 'Add a card', requestKind: 'arm', interaction: 'arm-then-click' },
  { id: 'note', shortcutKey: 'N', commandLabel: 'Add a note', requestKind: 'arm', interaction: 'arm-then-click' },
  { id: 'area', shortcutKey: 'A', commandLabel: 'Draw an area', requestKind: 'arm', interaction: 'arm-then-click' },
  { id: 'table', shortcutKey: 'T', commandLabel: 'New table', requestKind: 'picker', interaction: 'pick-then-place' },
  { id: 'image', shortcutKey: 'I', commandLabel: 'Add an image', requestKind: 'popover', interaction: 'paste-or-drop' },
  { id: 'pencil', shortcutKey: 'P', commandLabel: 'Draw with the pencil', requestKind: 'arm', interaction: 'drag-to-draw' },
  { id: 'eraser', shortcutKey: 'E', commandLabel: 'Erase things on the board', requestKind: 'arm', interaction: 'drag-to-erase' },
  { id: 'laser', shortcutKey: 'L', commandLabel: 'Point with the laser', requestKind: 'arm', interaction: 'ephemeral-drag' },
  { id: 'shape', shortcutKey: 'S', commandLabel: 'Draw a shape', requestKind: 'arm', interaction: 'drag-to-draw' },
]

// Every identity whose bare key ARMS a placement (as opposed to
// opening a picker/popover) -- shared/uiSignalStore.ts's own
// atlasArmToolRequest field derives its tool union from this rather
// than restating the id list, so a new 'arm'-kind tool never needs a
// second edit there.
export type AtlasArmRequestTool = Extract<AtlasToolIdentity, { requestKind: 'arm' }>['id']
