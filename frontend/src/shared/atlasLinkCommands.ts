import type { Command } from './commands'
import type { CommandContext } from './commandContext'
import { selectionContext } from './commandContext'
import { AtlasService } from './bindings'
import { atlasFacts } from './atlasSelectionFacts'
import { copy } from './copy'
import { requestAtlasSelectionAction } from './atlasSelectionStore'
import { soleCard, soleLink } from './atlasSelectionShape'

// The link, perspective-membership and space actions of the Atlas
// board's menus (goal 0346 slice B) -- the second half of
// shared/atlasSelectionCommands.ts, split at the 500-line convention.
// A data-driven item ("Add to <perspective>", a link kind's name) is
// one command with the chosen thing in the context's target, its
// label composed from that target.

const ATLAS: Command['surface'] = ['atlas']

// `label` is the palette's wording ("Open card"); `menuLabel` is the
// board menu's, shown whenever the item names a selection ("Open") --
// the surface keeps its own vocabulary, the command keeps its one id.
function command(id: string, label: string, menuLabel: string, enabled: (ctx?: CommandContext) => boolean, run: Command['run'], extra?: Partial<Command>): Command {
  const labelFor = (ctx?: CommandContext) => extra?.labelFor?.(ctx) ?? (selectionContext(ctx) ? copy(menuLabel) : undefined)
  return { id, label, defaultBinding: null, surface: ATLAS, needs: 'selection', enabled, run, ...extra, labelFor }
}

function chosenLinkKind(ctx: CommandContext | undefined): { link: string; kind: string; label: string } | undefined {
  const link = soleLink(ctx)
  const id = selectionContext(ctx)?.target?.linkKind
  const kind = id ? atlasFacts().linkKinds().find((k) => k.id === id) : undefined
  return link && kind ? { link, kind: kind.id, label: kind.label } : undefined
}

// The perspective an item names, with the selection's card ids -- a
// note or object never joins one (ADR-0041's MemberCardIDs).
function chosenPerspective(ctx: CommandContext | undefined): { id: string; name: string; cards: string[]; members: string[] } | undefined {
  const sel = selectionContext(ctx)
  const id = sel?.target?.perspective
  const perspective = id ? atlasFacts().perspectives().find((p) => p.id === id) : undefined
  if (!sel || !perspective || sel.cards.length === 0) return undefined
  return { id: perspective.id, name: perspective.name, cards: sel.cards, members: perspective.members }
}

function soleSpace(ctx: CommandContext | undefined): string | undefined {
  const card = soleCard(ctx)
  return card?.root ? card.id : undefined
}

export const ATLAS_LINK_COMMANDS: Command[] = [
  command('atlas.link.setKind', 'commands.atlas.link.setKind', 'atlas:contextMenu.changeLinkKind',
    (ctx) => Boolean(chosenLinkKind(ctx)),
    (ctx) => { const hit = chosenLinkKind(ctx); return hit ? AtlasService.SetLinkKind(hit.link, hit.kind) : undefined },
    { labelFor: (ctx) => chosenLinkKind(ctx)?.label }),
  command('atlas.link.editLabel', 'commands.atlas.link.editLabel', 'atlas:contextMenu.editLabel',
    (ctx) => Boolean(soleLink(ctx)),
    (ctx) => { const link = soleLink(ctx); if (link) requestAtlasSelectionAction({ action: 'editLinkLabel', link, pos: selectionContext(ctx)?.target?.pos }) }),
  command('atlas.link.remove', 'commands.atlas.link.remove', 'atlas:contextMenu.removeLink',
    (ctx) => Boolean(soleLink(ctx)),
    (ctx) => { const link = soleLink(ctx); return link ? AtlasService.DeleteLink(link) : undefined }),
  command('atlas.selection.addToPerspective', 'commands.atlas.selection.addToPerspective', 'commands.atlas.selection.addToPerspective',
    (ctx) => Boolean(chosenPerspective(ctx)),
    (ctx) => { const hit = chosenPerspective(ctx); if (hit) requestAtlasSelectionAction({ action: 'perspective', op: 'add', perspective: hit.id, cards: hit.cards }) },
    { labelFor: (ctx) => chosenPerspective(ctx)?.name }),
  command('atlas.selection.removeFromPerspective', 'commands.atlas.selection.removeFromPerspective', 'commands.atlas.selection.removeFromPerspective',
    // Only offered while at least one selected card is a member --
    // removing nothing is a dead end.
    (ctx) => { const hit = chosenPerspective(ctx); return Boolean(hit) && hit!.cards.some((id) => hit!.members.includes(id)) },
    (ctx) => { const hit = chosenPerspective(ctx); if (hit) requestAtlasSelectionAction({ action: 'perspective', op: 'remove', perspective: hit.id, cards: hit.cards }) },
    { labelFor: (ctx) => chosenPerspective(ctx)?.name }),
  // The space's own management (docs/goals/0183): the viewed root card
  // IS the space, so the empty-board menu hands it as the selection.
  {
    id: 'atlas.space.new',
    label: 'commands.atlas.space.new',
    defaultBinding: null,
    surface: ATLAS,
    labelFor: (ctx) => (ctx ? copy('atlas:contextMenu.newSpace') : undefined),
    run: () => requestAtlasSelectionAction({ action: 'newSpace' }),
  },
  command('atlas.space.rename', 'commands.atlas.space.rename', 'atlas:contextMenu.renameSpace',
    (ctx) => Boolean(soleSpace(ctx)),
    (ctx) => { const card = soleSpace(ctx); if (card) requestAtlasSelectionAction({ action: 'open', card }) }),
  command('atlas.space.delete', 'commands.atlas.space.delete', 'atlas:contextMenu.deleteSpace',
    (ctx) => Boolean(soleSpace(ctx)),
    (ctx) => { const card = soleSpace(ctx); if (card) requestAtlasSelectionAction({ action: 'deleteSpace', card }) }),
]
