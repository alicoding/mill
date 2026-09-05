import type { Command } from './commands'
import { jsonNodeContext } from './commandContext'
import { writeClipboardText } from './clipboardWrite'
import { useUISignalStore } from './uiSignalStore'

// Whether a board with something on it is on screen right now -- read
// from the live canvas rather than mirrored into a store: a mirror has
// to be written by an effect, and effect ordering across a board
// remount is exactly what a menu built mid-navigation reads wrongly
// (observed: the two image commands vanished from a live 2-card
// selection's own menu). Both commands are `surface: ['atlas']`, so no
// other canvas's nodes can satisfy this for them.
function atlasBoardHasContent(): boolean {
  return typeof document !== 'undefined' && document.querySelector('.react-flow__node') !== null
}

// The Atlas toolbar/board actions that were only ever reachable by
// clicking (goal 0071's discoverability trilogy extended to the rest
// of the surface) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), spread into its COMMANDS array. Every command
// here is `surface: ['atlas']`; each `run` just bumps a
// shared/uiSignalStore.ts counter the owning atlas/ component already
// watches, the same store-signal seam every other cross-bounded-
// context command in commands.ts uses.
// The board's currently selected DIAGRAM object, read from the live
// canvas the same way atlasBoardHasContent above reads it -- the node's
// own data-id IS the object id (atlasBuildBoardObjectNodes.ts). Null
// when the selection is anything else, which is diagram.fit's honest
// enablement: fitting a drawing needs a drawing to fit.
function selectedDiagramObjectID(): string | null {
  if (typeof document === 'undefined') return null
  const face = document.querySelector('.react-flow__node.selected [data-object-kind="diagram"]')
  return face?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
}

export const ATLAS_BOARD_COMMANDS: Command[] = [
  {
    id: 'atlas.arrange',
    label: 'commands.atlas.arrange',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasArrange(),
  },
  {
    // The board's Contents dialog (docs/goals/0279): every card, note,
    // and object listed by kind with display names.
    id: 'atlas.contents.open',
    label: 'commands.atlas.contents.open',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasContents(),
  },
  {
    id: 'atlas.import',
    label: 'commands.atlas.import',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasImport(),
  },
  {
    id: 'atlas.export',
    label: 'commands.atlas.export',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasExport(),
  },
  {
    // "Copy as image" / "Export as image..." (docs/goals/0201): both
    // picture the LIVE selection, and with nothing selected both widen
    // to the whole board rather than refusing -- so the only state
    // that can make them invalid is an empty board.
    //
    // Unbound by construction, not by preference. The converged key for
    // this action is a bare Shift+Option+C, and comboFromEvent requires
    // Cmd or Ctrl specifically (shared/keybinding.ts's own doc comment):
    // a modifier set without one of those two never becomes a KeyCombo,
    // so no binding here could dispatch. Freely assignable in
    // Settings > Keyboard Shortcuts, same as every other
    // defaultBinding: null command.
    id: 'atlas.selection.copyAsImage',
    label: 'commands.atlas.selection.copyAsImage',
    defaultBinding: null,
    surface: ['atlas'],
    enabled: atlasBoardHasContent,
    run: () => useUISignalStore.getState().requestAtlasCopyImage(),
  },
  {
    id: 'atlas.selection.exportAsImage',
    label: 'commands.atlas.selection.exportAsImage',
    defaultBinding: null,
    surface: ['atlas'],
    enabled: atlasBoardHasContent,
    run: () => useUISignalStore.getState().requestAtlasExportImage(),
  },
  {
    id: 'atlas.addFromFolder',
    label: 'commands.atlas.addFromFolder',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasAddFromFolder(),
  },
  {
    id: 'atlas.share.copyContext',
    label: 'commands.atlas.share.copyContext',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasShareCopyContext(),
  },
  {
    id: 'atlas.share.copyLinks',
    label: 'commands.atlas.share.copyLinks',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasShareCopyLinks(),
  },
  {
    id: 'atlas.perspective',
    label: 'commands.atlas.perspective',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasPerspectiveSwitcherOpen(),
  },
  {
    // ⌘A select-all: the real keydown is a dedicated, editable-target-
    // guarded listener in app/useKeymapDispatch.ts, not the generic
    // dispatch below -- a generic match would preventDefault()
    // unconditionally and break native select-all-text inside any
    // Atlas input. defaultBinding still drives HotkeyHint/the Shortcuts
    // Help overlay's display.
    id: 'atlas.selectAll',
    label: 'commands.atlas.selectAll',
    defaultBinding: { mods: ['cmd'], key: 'A' },
    hintOnly: true,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasSelectAll(),
  },
  {
    // Unreachable by construction: hintOnly skips generic dispatch,
    // paletteHidden excludes the palette, and ShortcutsHelpDialog's
    // rows carry no onSelect -- this entry exists only to satisfy
    // Command.run's required type. The real action lives in
    // useAtlasSelectionTray.ts's own onDelete/AtlasBoard's Delete/
    // Backspace listener.
    id: 'atlas.delete.selection',
    label: 'commands.atlas.delete.selection',
    defaultBinding: { mods: [], key: 'Delete' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // Unreachable by construction, same reasoning as atlas.delete.selection
    // above -- the real action lives in useAtlasSelectionTray.ts's own
    // triggerGroup/groupFromKeyboard.
    id: 'atlas.group.selection',
    label: 'commands.atlas.group.selection',
    defaultBinding: { mods: [], key: 'G' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // "Fit diagram" (goal 0354): a diagram board object shows no
    // vendored toolbar, so its zoom-to-fit is the object's own action --
    // on the palette, and on the object's menu beside the full-editor
    // door. The run bumps the signal the frame holding that object's
    // live viewer watches, which calls the viewer's own graph.fit()
    // (atlas/drawioInteraction.ts) rather than a second geometry.
    id: 'diagram.fit',
    label: 'commands.diagram.fit',
    defaultBinding: null,
    surface: ['atlas'],
    enabled: () => selectedDiagramObjectID() !== null,
    run: () => {
      const id = selectedDiagramObjectID()
      if (id) useUISignalStore.getState().requestAtlasDiagramFit(id)
    },
  },
  {
    // "Open in default app" (goal 0232 S1): a file-backed board
    // object's own registry command -- mouse-only by construction (its
    // target is whichever object was right-clicked, which the palette/
    // keyboard dispatch path has no way to supply), so paletteHidden
    // per that field's own doc comment, same shape atlas.delete.selection
    // above already takes for the identical constraint. The real,
    // per-object run() and its honest fileBacked+mirrorPath enablement
    // live in useAtlasObjectMenu.ts, which shares this commandId so the
    // menu item's label/HotkeyHint resolve from here.
    id: 'object.openInDefaultApp',
    label: 'commands.object.openInDefaultApp',
    defaultBinding: null,
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // "Rename" (goal 0273): a table board object's own registry
    // command -- mouse-only by construction for the same reason
    // object.openInDefaultApp above is (its target is whichever object
    // was right-clicked, which the palette/keyboard dispatch path has
    // no way to supply), so paletteHidden per that field's own doc
    // comment. The real per-object run() and its honest Kind-based
    // enablement live in atlas/useAtlasObjectMenu.ts, which shares this
    // commandId so the menu item's label/HotkeyHint resolve from here.
    id: 'object.rename',
    label: 'commands.object.rename',
    defaultBinding: null,
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    // The Sparkle companion-panel toggle (goal 0101 slice 1,
    // AtlasToolbar.tsx) -- the button now calls this command instead of
    // toggleCompanion directly, same "button runs the command" shape
    // every other migrated action in goal 0222 S1 follows. Always valid
    // while on the atlas surface -- opening/closing has no invalid
    // state, so no `enabled` predicate is needed here.
    id: 'atlas.companion.toggle',
    label: 'commands.atlas.companion.toggle',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().toggleCompanion(),
  },
  {
    id: 'atlas.minimap.toggle',
    label: 'commands.atlas.minimap.toggle',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasMinimapToggle(),
  },
  {
    // Export-as (ADR-0043 §3, goal 0133 slice E1): the ONE command id
    // the card page's kebab menu and its right-click context menu also
    // key off (AtlasCardPageHeader.tsx / useAtlasLinkMenus.tsx), per the
    // integration-surfaces triage's "sharing commandIds" requirement.
    // Consumed by whichever card page is currently open
    // (AtlasCardOverlay.tsx); a harmless no-op with no card page open.
    id: 'atlas.card.exportAs',
    label: 'commands.atlas.card.exportAs',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasCardExportAs(),
  },
  // The six entries below (goal 0106 slice B) advertise useAtlasKeyboardNav.ts's
  // own key table (goal 0104) in the Shortcuts Help overlay -- every
  // one is unreachable by construction, same shape as
  // atlas.delete.selection/atlas.group.selection above: comboFromEvent
  // requires Cmd/Ctrl by design (shared/keybinding.ts), so none of
  // these bare/Option/Shift combos can ever be a REAL dispatched
  // binding, and each acts on live board focus/selection state the
  // palette has no way to supply -- paletteHidden keeps a dead click
  // out of it. The real handling stays entirely in
  // useAtlasKeyboardNav.ts's own window keydown listener.
  {
    id: 'atlas.focusNext',
    label: 'commands.atlas.focusNext',
    defaultBinding: { mods: [], key: 'Tab' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.focusPrevious',
    label: 'commands.atlas.focusPrevious',
    defaultBinding: { mods: ['shift'], key: 'Tab' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.focusDirection',
    label: 'commands.atlas.focusDirection',
    defaultBinding: { mods: ['option'], key: 'ArrowRight' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.openFocused',
    label: 'commands.atlas.openFocused',
    defaultBinding: { mods: [], key: 'Enter' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.nudgeSelection',
    label: 'commands.atlas.nudgeSelection',
    defaultBinding: { mods: [], key: 'ArrowRight' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  {
    id: 'atlas.escapeLadder',
    label: 'commands.atlas.escapeLadder',
    defaultBinding: { mods: [], key: 'Escape' },
    hintOnly: true,
    paletteHidden: true,
    surface: ['atlas'],
    run: () => {},
  },
  // The three copies a row of a JSON/YAML board object offers (goal
  // 0269), each acting on the row the FACE hands it (goal 0343's
  // context parameter, the same shape the Configure inventory rows
  // take): the row menu supplies the right-clicked row, the face's own
  // Cmd+C supplies the focused one. paletteHidden because neither the
  // palette nor the keydown dispatcher can name a tree row --
  // ambientContext() resolves no jsonNode, so `needs` below is also
  // what keeps a stray Cmd+C anywhere else in the app from reaching
  // Copy value.
  ...jsonRowCommands(),
]

// One factory rather than three near-identical literals: the three
// commands differ only in which field of the row they write, and
// `dupl`/sonarjs both read three copies of the same eight lines as the
// duplication they are.
function jsonRowCommands(): Command[] {
  const fields = [
    { id: 'copyValue', field: 'value' },
    { id: 'copyPath', field: 'path' },
    { id: 'copyKey', field: 'key' },
  ] as const
  return fields.map(({ id, field }): Command => ({
    id: `atlas.json.${id}`,
    label: `commands.atlas.json.${id}`,
    // Cmd+C on the focused row copies its value, the browser-inspector
    // convention. Never dispatched generically (see the note above the
    // call): the face runs it directly with the focused row as the
    // target, and this binding is what the row menu's own hint shows.
    defaultBinding: id === 'copyValue' ? { mods: ['cmd'], key: 'C' } : null,
    paletteHidden: true,
    surface: ['atlas'],
    needs: 'jsonNode',
    enabled: (ctx) => Boolean(jsonNodeContext(ctx)),
    run: (ctx) => {
      const row = jsonNodeContext(ctx)
      if (!row) return
      return writeClipboardText(row[field])
    },
  }))
}
