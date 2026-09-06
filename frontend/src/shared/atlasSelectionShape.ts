import type { CommandContext } from './commandContext'
import { selectionContext, type SelectionContext } from './commandContext'
import { atlasFacts, type AtlasCardFacts, type AtlasObjectFacts } from './atlasSelectionFacts'

// The shape tests every selection command's enablement asks (goal 0346
// slice B): "exactly one card and nothing else", "one note", "at least
// two things". Honest by construction -- a command that acts on one
// card is unavailable over two, and a command that acts on the whole
// selection needs the count it says it needs.

const ARTERY_MENU_TITLE_MAX = 28

// A composed label ("Open <title>") stays one line regardless of how
// long the named card's title is.
export function truncateTitle(title: string): string {
  return title.length > ARTERY_MENU_TITLE_MAX ? `${title.slice(0, ARTERY_MENU_TITLE_MAX - 1)}…` : title
}

export function placedCount(sel: SelectionContext): number {
  return sel.cards.length + sel.notes.length + sel.objects.length
}

export function soleCard(ctx: CommandContext | undefined): AtlasCardFacts | undefined {
  const sel = selectionContext(ctx)
  if (!sel || sel.cards.length !== 1 || sel.notes.length !== 0 || sel.objects.length !== 0) return undefined
  return atlasFacts().card(sel.cards[0])
}

export function soleNote(ctx: CommandContext | undefined): string | undefined {
  const sel = selectionContext(ctx)
  if (!sel || sel.notes.length !== 1 || sel.cards.length !== 0 || sel.objects.length !== 0) return undefined
  return atlasFacts().note(sel.notes[0]) ? sel.notes[0] : undefined
}

export function soleObject(ctx: CommandContext | undefined): AtlasObjectFacts | undefined {
  const sel = selectionContext(ctx)
  if (!sel || sel.objects.length !== 1 || sel.cards.length !== 0 || sel.notes.length !== 0) return undefined
  return atlasFacts().object(sel.objects[0])
}

export function soleLink(ctx: CommandContext | undefined): string | undefined {
  const sel = selectionContext(ctx)
  if (!sel || sel.links.length !== 1) return undefined
  return atlasFacts().link(sel.links[0]) ? sel.links[0] : undefined
}

// The frame an "add inside" acts on: the sole selected group card, or
// the space itself ('' -- the board's own level) when nothing is
// selected. Undefined for any other shape.
export function addTargetFrame(ctx: CommandContext | undefined): { frame: string; title: string } | undefined {
  const sel = selectionContext(ctx)
  if (!sel) return undefined
  if (placedCount(sel) === 0) return { frame: '', title: '' }
  const card = soleCard(ctx)
  return card?.isGroup ? { frame: card.id, title: card.title } : undefined
}
