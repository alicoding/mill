import type { Command } from './commands'
import type { CommandContext } from './commandContext'
import { selectionContext } from './commandContext'
import { AtlasService } from './bindings'
import { copy } from './copy'
import { writeClipboardText } from './clipboardWrite'
import { atlasFacts } from './atlasSelectionFacts'
import { requestAtlasSelectionAction } from './atlasSelectionStore'
import { addTargetFrame, soleCard, soleNote, soleObject, truncateTitle } from './atlasSelectionShape'
import { ATLAS_LINK_COMMANDS } from './atlasLinkCommands'

// Every action the Atlas board's right-click menus offer on a card, a
// note, a board object or the pane, as registry commands over the
// selection context (goal 0346 slice B). Each declares needs:
// 'selection': a menu hands the thing it was opened on, the palette
// and a keystroke hand the live selection (shared/ambientContext.ts),
// and the SAME command runs either way. What only the board's own UI
// can do (open the card page, a popover, the undo toast) goes through
// requestAtlasSelectionAction, the downward request AtlasView
// consumes; a plain service call is placed here.
//
// No menu seat for any of these: a menu bar has no card to point at.

const ATLAS: Command['surface'] = ['atlas']

// `label` is the palette's wording ("Open card"); `menuLabel` is the
// board menu's, shown whenever the item names a selection ("Open") --
// the surface keeps its own vocabulary, the command keeps its one id.
function command(id: string, label: string, menuLabel: string, enabled: (ctx?: CommandContext) => boolean, run: Command['run'], extra?: Partial<Command>): Command {
  const labelFor = (ctx?: CommandContext) => extra?.labelFor?.(ctx) ?? (selectionContext(ctx) ? copy(menuLabel) : undefined)
  return { id, label, defaultBinding: null, surface: ATLAS, needs: 'selection', enabled, run, ...extra, labelFor }
}

export const ATLAS_CARD_COMMANDS: Command[] = [
  command('atlas.card.open', 'commands.atlas.card.open', 'atlas:contextMenu.open',
    (ctx) => Boolean(openTarget(ctx)),
    (ctx) => { const card = openTarget(ctx); if (card) requestAtlasSelectionAction({ action: 'open', card }) },
    {
      // "Open <title>" when the item names a card other than the
      // selection itself -- an artery's two ends.
      labelFor: (ctx) => {
        const target = selectionContext(ctx)?.target?.card
        const card = target ? atlasFacts().card(target) : undefined
        return card ? copy('atlas:contextMenu.openCard', { title: truncateTitle(card.title) }) : undefined
      },
    }),
  command('atlas.card.zoomIn', 'commands.atlas.card.zoomIn', 'atlas:contextMenu.zoomIn',
    (ctx) => soleCard(ctx)?.isGroup === true,
    (ctx) => { const card = soleCard(ctx); if (card) requestAtlasSelectionAction({ action: 'zoom', card: card.id }) }),
  command('atlas.card.openFile', 'commands.atlas.card.openFile', 'atlas:contextMenu.openFile',
    (ctx) => soleCard(ctx)?.mirrorPath === true,
    (ctx) => { const card = soleCard(ctx); return card ? AtlasService.OpenCardMirror(card.id) : undefined }),
  command('atlas.card.revealInFileManager', 'commands.atlas.card.revealInFileManager', 'atlas:contextMenu.revealInFileManager',
    (ctx) => soleCard(ctx)?.mirrorPath === true,
    (ctx) => { const card = soleCard(ctx); return card ? AtlasService.RevealCardMirror(card.id) : undefined }),
  command('atlas.card.refreshFromFolder', 'commands.atlas.card.refreshFromFolder', 'atlas:contextMenu.refreshFromFolder',
    (ctx) => { const card = soleCard(ctx); return card?.mirrorPath === true && card.isGroup },
    (ctx) => { const card = soleCard(ctx); return card ? AtlasService.RefreshMirrorContainer(card.id) : undefined }),
  command('atlas.card.addLinkedCard', 'commands.atlas.card.addLinkedCard', 'atlas:contextMenu.addLinkedCard',
    (ctx) => Boolean(soleCard(ctx)),
    (ctx) => { const card = soleCard(ctx); if (card) requestAtlasSelectionAction({ action: 'addLinkedCard', card: card.id, pos: selectionContext(ctx)?.target?.pos }) }),
  command('atlas.card.fitToContent', 'commands.atlas.card.fitToContent', 'atlas:contextMenu.fitToContent',
    // Only the plain note face has content that clips by a fixed line
    // count -- a frame's box is computed from its children and a
    // table's from its rows, neither of which this measures.
    (ctx) => { const card = soleCard(ctx); return Boolean(card) && !card!.isGroup && !card!.projection },
    (ctx) => {
      const card = soleCard(ctx)
      if (!card) return
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${card.id}"] [data-testid="atlas-note-card"]`)
      if (!el) return
      // scrollHeight under a temporary height:auto is this card's true
      // natural content height (flex children with min-height:0
      // collapse to nothing left to grow into once the parent itself
      // has no fixed height) -- overflow:clip still reports it
      // correctly, it just never PAINTS past the box while clamped.
      const previousHeight = el.style.height
      el.style.height = 'auto'
      const naturalHeight = el.scrollHeight
      el.style.height = previousHeight
      return AtlasService.SetCardSize(card.id, el.offsetWidth, naturalHeight)
    }),
  command('atlas.card.copyContext', 'commands.atlas.card.copyContext', 'atlas:share.copyContext',
    (ctx) => Boolean(soleCard(ctx)),
    async (ctx) => {
      const card = soleCard(ctx)
      if (!card) return
      await writeClipboardText(await AtlasService.CardContextBlock(card.id, false))
    }),
  command('atlas.card.copyLink', 'commands.atlas.card.copyLink', 'atlas:share.copyCloudLink',
    (ctx) => Boolean(soleCard(ctx)),
    (ctx) => { const card = soleCard(ctx); return card ? writeClipboardText(card.source) : undefined }),
  command('atlas.card.dissolve', 'commands.atlas.card.dissolve', 'atlas:contextMenu.dissolveArea',
    (ctx) => soleCard(ctx)?.isGroup === true,
    (ctx) => { const card = soleCard(ctx); if (card) requestAtlasSelectionAction({ action: 'dissolve', card: card.id }) }),
  // "Add card"/"Add note" at a point: inside the sole selected frame,
  // or on the board itself when nothing is selected. The frame is
  // always named once it is the destination (goal 0081 A2).
  command('atlas.board.addCard', 'commands.atlas.board.addCard', 'atlas:contextMenu.addCardHere',
    (ctx) => Boolean(addTargetFrame(ctx)),
    (ctx) => addInside(ctx, 'card'),
    { labelFor: (ctx) => { const t = addTargetFrame(ctx); return t?.frame ? copy('atlas:contextMenu.addCardTo', { title: t.title }) : undefined } }),
  command('atlas.board.addNote', 'commands.atlas.board.addNote', 'atlas:contextMenu.addNoteHere',
    (ctx) => Boolean(addTargetFrame(ctx)),
    (ctx) => addInside(ctx, 'note'),
    { labelFor: (ctx) => (addTargetFrame(ctx)?.frame ? copy('atlas:contextMenu.addNoteInside') : undefined) }),
  command('atlas.note.open', 'commands.atlas.note.open', 'atlas:contextMenu.openNote',
    (ctx) => Boolean(soleNote(ctx)),
    (ctx) => { const note = soleNote(ctx); if (note) requestAtlasSelectionAction({ action: 'openNote', note }) }),
  command('atlas.note.promote', 'commands.atlas.note.promote', 'atlas:contextMenu.promoteToCard',
    (ctx) => Boolean(soleNote(ctx)),
    (ctx) => { const note = soleNote(ctx); if (note) requestAtlasSelectionAction({ action: 'promoteNote', note, pos: selectionContext(ctx)?.target?.pos }) }),
  command('atlas.object.promote', 'commands.atlas.object.promote', 'atlas:contextMenu.promoteToCard',
    (ctx) => Boolean(soleObject(ctx)),
    (ctx) => { const object = soleObject(ctx); if (object) requestAtlasSelectionAction({ action: 'promoteObject', object: object.id, pos: selectionContext(ctx)?.target?.pos }) }),
  command('object.editDiagram', 'commands.object.editDiagram', 'atlas:contextMenu.editDiagram',
    (ctx) => soleObject(ctx)?.editDiagram === true,
    (ctx) => { const object = soleObject(ctx); if (object) requestAtlasSelectionAction({ action: 'editDiagram', object: object.id }) }),
  // A plugin's own item on an object of its kind (goal 0280): one
  // command, the item named in the target, its label the plugin's own.
  command('atlas.object.pluginAction', 'commands.atlas.object.pluginAction', 'commands.atlas.object.pluginAction',
    (ctx) => Boolean(pluginItem(ctx)),
    (ctx) => { const hit = pluginItem(ctx); if (hit) requestAtlasSelectionAction({ action: 'pluginAction', object: hit.object, item: hit.id }) },
    { labelFor: (ctx) => pluginItem(ctx)?.label }),
  ...ATLAS_LINK_COMMANDS,
]

export const ATLAS_SELECTION_COMMANDS: Command[] = ATLAS_CARD_COMMANDS

function openTarget(ctx: CommandContext | undefined): string | undefined {
  const target = selectionContext(ctx)?.target?.card
  if (target) return atlasFacts().card(target) ? target : undefined
  return soleCard(ctx)?.id
}

function addInside(ctx: CommandContext | undefined, tool: 'card' | 'note'): void {
  const target = addTargetFrame(ctx)
  if (target) requestAtlasSelectionAction({ action: 'addInside', frame: target.frame, tool, pos: selectionContext(ctx)?.target?.pos })
}

function pluginItem(ctx: CommandContext | undefined): { object: string; id: string; label: string } | undefined {
  const object = soleObject(ctx)
  const id = selectionContext(ctx)?.target?.pluginItem
  const item = id ? object?.pluginItems.find((i) => i.id === id) : undefined
  return item ? { object: object!.id, id: item.id, label: item.label } : undefined
}
