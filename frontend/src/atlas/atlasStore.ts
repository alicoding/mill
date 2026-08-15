import { create } from 'zustand'
import { AtlasService } from '../shared/bindings'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The Atlas surface's own "one fetch, many consumers" store (mirrors
// shared/configureEntityStore.ts's shape) -- kept inside atlas/ rather
// than shared/ since only atlas/ itself and app/ (QuickPanel's card
// search, App.tsx's mill-data-changed router) ever read it, and
// dependency-cruiser's boundary lets app/ import from atlas/.
interface AtlasState {
  kinds: Kind[] | null
  linkKinds: LinkKind[] | null
  cards: Card[] | null
  links: Link[] | null
  setKinds: (kinds: Kind[]) => void
  setLinkKinds: (linkKinds: LinkKind[]) => void
  setCards: (cards: Card[]) => void
  setLinks: (links: Link[]) => void
}

export const useAtlasStore = create<AtlasState>()((set) => ({
  kinds: null,
  linkKinds: null,
  cards: null,
  links: null,
  setKinds: (kinds) => set({ kinds }),
  setLinkKinds: (linkKinds) => set({ linkKinds }),
  setCards: (cards) => set({ cards }),
  setLinks: (links) => set({ links }),
}))

export function refreshAtlasKinds(): Promise<void> {
  return AtlasService.Kinds()
    .then((list) => useAtlasStore.getState().setKinds(list ?? []))
    .catch(console.error)
}

export function refreshAtlasLinkKinds(): Promise<void> {
  return AtlasService.LinkKinds()
    .then((list) => useAtlasStore.getState().setLinkKinds(list ?? []))
    .catch(console.error)
}

export function refreshAtlasCards(): Promise<void> {
  return AtlasService.Cards()
    .then((list) => useAtlasStore.getState().setCards(list ?? []))
    .catch(console.error)
}

export function refreshAtlasLinks(): Promise<void> {
  return AtlasService.Links()
    .then((list) => useAtlasStore.getState().setLinks(list ?? []))
    .catch(console.error)
}

// The one call site every mounter of the Atlas surface (AtlasView on
// mount, App.tsx/QuickPanel.tsx's mill-data-changed 'atlas' handler)
// uses -- refetches all four entity families together since they're one
// storage blob server-side (atlassvc's atlasStateKey) and a single
// dataevent.Emit("atlas", ...) never says which family actually
// changed.
export function refreshAtlas(): Promise<void> {
  return Promise.all([refreshAtlasKinds(), refreshAtlasLinkKinds(), refreshAtlasCards(), refreshAtlasLinks()]).then(() => undefined)
}
