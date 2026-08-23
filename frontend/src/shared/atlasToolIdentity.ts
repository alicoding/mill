// The atlas creation tools' cross-layer identity: id, bare shortcut
// key, and command-palette label, plus which uiSignalStore request a
// bare keypress fires. Lives here rather than in atlas/atlasTools.ts
// (the tool registry's real home, carrying icon/interaction/commit)
// because shared/ can never import atlas/ (dependency-cruiser's
// shared-is-a-leaf rule), while shared/commands.ts still needs each
// tool's id and shortcut key to generate its own Command.
// atlasTools.ts imports this array to source its own id/shortcutKey/
// label rather than restating them -- one owner for the identity list
// regardless of which layer is asking.
export type AtlasToolRequestKind = 'arm' | 'picker' | 'popover'

// Five distinct members, not one member with a unioned id -- so that
// Extract<AtlasToolIdentity, { id: 'card' }> (atlasTools.ts's own
// lookup) can actually narrow to a single one.
export type AtlasToolIdentity =
  | { id: 'card'; shortcutKey: string; commandLabel: string; requestKind: 'arm' }
  | { id: 'note'; shortcutKey: string; commandLabel: string; requestKind: 'arm' }
  | { id: 'area'; shortcutKey: string; commandLabel: string; requestKind: 'arm' }
  | { id: 'table'; shortcutKey: string; commandLabel: string; requestKind: 'picker' }
  | { id: 'image'; shortcutKey: string; commandLabel: string; requestKind: 'popover' }

export const ATLAS_TOOL_IDENTITIES: AtlasToolIdentity[] = [
  { id: 'card', shortcutKey: 'C', commandLabel: 'Add a card', requestKind: 'arm' },
  { id: 'note', shortcutKey: 'N', commandLabel: 'Add a note', requestKind: 'arm' },
  { id: 'area', shortcutKey: 'A', commandLabel: 'Draw an area', requestKind: 'arm' },
  { id: 'table', shortcutKey: 'T', commandLabel: 'New table', requestKind: 'picker' },
  { id: 'image', shortcutKey: 'I', commandLabel: 'Add an image', requestKind: 'popover' },
]
