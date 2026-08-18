import { useState } from 'react'
import type { Card, Link, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { filterCardsByPerspective, filterLinksByPerspective } from './atlasPerspectiveFilter'

// AtlasView's own perspective state + writers (ADR-0041, goal 0095
// slice 2) -- split out of AtlasView.tsx (architecture.md's 500-line
// convention). Owns activePerspectiveID (persisted into
// AtlasSessionState by AtlasView's own existing session effect, via
// setActivePerspectiveID exposed here for that one restore call) and
// the board-scoped membership filtering every board render below it
// consumes. Switching itself never calls the service -- it's a local,
// session-persisted selection; create/rename/delete call
// AtlasService directly and refresh the shared store.
export function useAtlasPerspectives({ viewedID, allCards, allLinks, allPerspectives }: {
  viewedID: string
  allCards: Card[]
  allLinks: Link[]
  allPerspectives: Perspective[]
}) {
  // "" is the default "everything" view -- the ABSENCE of a Perspective,
  // never an empty one.
  const [activePerspectiveID, setActivePerspectiveID] = useState('')
  const activePerspective = allPerspectives.find((p) => p.ID === activePerspectiveID) ?? null

  // MemberCardIDs is already closed under ancestry by the service's own
  // writers, so filtering the flat card list keeps containment visible
  // with no separate ancestor walk needed on this side. A link
  // additionally needs both its endpoints to be members (the stored,
  // not derived, link rule).
  const boardAllCards = filterCardsByPerspective(allCards, activePerspective)
  const boardLinks = filterLinksByPerspective(allLinks, activePerspective)

  const switchPerspective = (id: string) => setActivePerspectiveID(id)

  const createPerspective = async (name: string) => {
    const p = await AtlasService.CreatePerspective(viewedID, name, '')
    await refreshAtlas()
    setActivePerspectiveID(p.ID)
  }

  const renamePerspective = async (id: string, name: string) => {
    await AtlasService.RenamePerspective(id, name, '')
    await refreshAtlas()
  }

  const deletePerspective = async (id: string) => {
    await AtlasService.DeletePerspective(id)
    if (activePerspectiveID === id) setActivePerspectiveID('')
    await refreshAtlas()
  }

  return {
    activePerspectiveID, setActivePerspectiveID, activePerspective,
    boardAllCards, boardLinks,
    switchPerspective, createPerspective, renamePerspective, deletePerspective,
  }
}
