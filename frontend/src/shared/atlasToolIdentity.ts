// The atlas creation tools' cross-layer identity: id, bare shortcut
// key, command-palette label KEY (shared/copy.ts resolves it), which uiSignalStore request a bare
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

// Five distinct members, not one member with a unioned id -- so that
// Extract<AtlasToolIdentity, { id: 'card' }> (each noun module's own
// lookup) can actually narrow to a single one. The drawing tools
// (pencil/eraser/laser/shape) are NOT here anymore: goal 0252 demoted
// them into the bundled Drawing runtime plugin, so they register as
// third-party nouns with open-string ids, like any plugin tool.
export type AtlasToolIdentity =
  | { id: 'card'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'arm-then-click' }
  | { id: 'note'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'arm-then-click' }
  // area's own runtime gesture is a marquee drag, not a single click
  // (goal 0215 S2 corrects the classification lie: its OWN
  // useAtlasAreaDraw.ts always was a drag hook) -- requestKind stays
  // 'arm' since a bare keypress still just arms the tool, same as
  // every other 'arm' entry here.
  | { id: 'area'; shortcutKey: string; commandLabel: string; requestKind: 'arm'; interaction: 'drag-to-draw' }
  | { id: 'table'; shortcutKey: string; commandLabel: string; requestKind: 'picker'; interaction: 'pick-then-place' }
  | { id: 'image'; shortcutKey: string; commandLabel: string; requestKind: 'popover'; interaction: 'paste-or-drop' }

export const ATLAS_TOOL_IDENTITIES: AtlasToolIdentity[] = [
  { id: 'card', shortcutKey: 'C', commandLabel: 'commands.atlas.create.card', requestKind: 'arm', interaction: 'arm-then-click' },
  { id: 'note', shortcutKey: 'N', commandLabel: 'commands.atlas.create.note', requestKind: 'arm', interaction: 'arm-then-click' },
  { id: 'area', shortcutKey: 'A', commandLabel: 'commands.atlas.create.area', requestKind: 'arm', interaction: 'drag-to-draw' },
  { id: 'table', shortcutKey: 'T', commandLabel: 'commands.atlas.create.table', requestKind: 'picker', interaction: 'pick-then-place' },
  { id: 'image', shortcutKey: 'I', commandLabel: 'commands.atlas.create.image', requestKind: 'popover', interaction: 'paste-or-drop' },
]

// Every identity whose bare key ARMS a placement (as opposed to
// opening a picker/popover) -- shared/uiSignalStore.ts's own
// atlasArmToolRequest field derives its tool union from this rather
// than restating the id list, so a new 'arm'-kind tool never needs a
// second edit there.
export type AtlasArmRequestTool = Extract<AtlasToolIdentity, { requestKind: 'arm' }>['id']
