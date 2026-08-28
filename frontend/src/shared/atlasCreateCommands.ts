import type { Command } from './commands'
import { ATLAS_TOOL_IDENTITIES } from './atlasToolIdentity'
import { useUISignalStore } from './uiSignalStore'
import { isExtensionEnabled } from './extensionEnablementStore'

// atlas.create.card/note/area/table/image (bare C/N/A/T/I, goal 0081
// slices A1/A2, goal 0139, goal 0169 slice 2): split out of
// shared/commands.ts (CLAUDE.md's 500-line convention), spread into
// its COMMANDS array -- same "own file per feature-specific command
// cluster" placement every other *_COMMANDS export there already
// establishes. comboFromEvent requires Cmd/Ctrl by design (every other
// keymap default needs one of the two -- see its own doc comment,
// shared/keybinding.ts), so a bare letter can never be one of these
// commands' REAL dispatched binding -- defaultBinding stays null, same
// shape help.shortcuts (commands.ts) already takes for its own bare
// `?`. The actual keypress is a dedicated listener
// (app/useKeymapDispatch.ts) that calls run() directly; the tray
// itself (AtlasCreationTray.tsx) renders its own kbd hint from the
// SAME registry (atlas/atlasTools.ts), not derived from this binding.
// Generated from shared/atlasToolIdentity.ts's identity list (the
// cross-layer seed atlas/atlasTools.ts's own descriptors also read)
// rather than one hand-written command per tool -- 'arm' tools request
// a placement arm, 'picker' requests the size picker (Table's own
// click-IS-the-creation flow), 'popover' requests the image tool's own
// path/paste popover.
export const ATLAS_CREATE_COMMANDS: Command[] = ATLAS_TOOL_IDENTITIES.map((tool): Command => ({
  id: `atlas.create.${tool.id}`,
  label: tool.commandLabel,
  defaultBinding: null,
  surface: ['atlas'],
  // A disabled tool's own command vanishes from palette + bare-key dispatch (Settings > Extensions), same truth the tray filter reads.
  enabled: () => isExtensionEnabled(tool.id),
  run: () => {
    if (tool.requestKind === 'picker') return useUISignalStore.getState().requestAtlasTablePicker()
    if (tool.requestKind === 'popover') return useUISignalStore.getState().requestAtlasImagePopover()
    return useUISignalStore.getState().requestAtlasArmTool(tool.id)
  },
}))
