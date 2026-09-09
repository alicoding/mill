import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { SEEDED_SCRATCHPAD_CARD_ID } from './quickPanelCapture'

export interface Target { pluginID: string; captureID: string }

export function targetFromHash(): Target | null {
  const query = window.location.hash.split('?')[1]
  if (!query) return null
  const params = new URLSearchParams(query)
  const captureID = params.get('id') ?? ''
  if (!captureID) return null
  return { pluginID: params.get('plugin') ?? '', captureID }
}

export function destinationKey(target: Target): string {
  return target.pluginID ? `${target.pluginID}/${target.captureID}` : target.captureID
}

// destinationOptions: the seeded Scratchpad first (the away-capture
// door's own inbox, goal 0090), then every top-level card by title,
// then the board's top level.
export function destinationOptions(cards: Card[]): { id: string; label: string }[] {
  const scratchpad = cards.find((c) => c.ID === SEEDED_SCRATCHPAD_CARD_ID)
  const roots = cards.filter((c) => !c.ParentID && c.ID !== SEEDED_SCRATCHPAD_CARD_ID).sort((a, b) => a.Title.localeCompare(b.Title))
  return [
    ...(scratchpad ? [{ id: scratchpad.ID, label: scratchpad.Title }] : []),
    ...roots.map((c) => ({ id: c.ID, label: c.Title })),
  ]
}
