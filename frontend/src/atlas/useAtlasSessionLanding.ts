import { useEffect, useRef, useState } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { singleRootCard } from './atlasGrouping'

// Session restore + the egocentric-root auto-entry (ADR-0038,
// docs/goals/0091/0183/0221), split from AtlasView at the 500-line
// convention.
//
// Session restore: land where you stood -- one-shot on mount, before
// the single-root redirect can claim the landing. The service already
// degrades stale ids (deleted viewed card -> root, deleted open card
// -> dropped), so what arrives here is always renderable. A deep link
// owns the landing entirely when present -- that flow's own
// viewedID=="" (a root-level target's own space) is a deliberate
// destination, not a state to redirect away from.
//
// Egocentric-root auto-entry: with exactly one root card
// (ParentID==="") viewedID=="" resolves straight into it, UNLESS
// suppressAutoEntry says the user just chose to be there
// (docs/goals/0183: resolving unconditionally used to silently undo a
// deliberate atlas.up/breadcrumb navigation on landing, re-trapping a
// lone space with no way out). suppressAutoEntry is set by
// navigate/drill in AtlasView exactly when a real card is deliberately
// left FOR the meta level -- never by a delete/promote landing there
// as its aftermath, which stays eligible to auto-resolve like any
// other viewedID==="" arrival.
//
// AtRootExplicit (goal 0221): a persisted root landing
// (session.viewedID=="") is otherwise indistinguishable from a
// never-saved session -- both leave viewedID at its own initial ""
// default on restore. AtRootExplicit is the only signal telling them
// apart, round-tripped through AtlasSessionState so a relaunch right
// after a deliberate "All spaces" landing doesn't re-enter the lone
// root card the user just backed out of.
export function useAtlasSessionLanding({
  initialCardID, cards, viewedID, setViewedID, overlayCardID, setOverlayCardID,
  activePerspectiveID, setActivePerspectiveID,
}: {
  initialCardID: string | undefined
  cards: Card[] | null
  viewedID: string
  setViewedID: (id: string) => void
  overlayCardID: string | null
  setOverlayCardID: (id: string | null) => void
  activePerspectiveID: string
  setActivePerspectiveID: (id: string) => void
}): { sessionRestored: boolean; suppressAutoEntry: boolean; setSuppressAutoEntry: (v: boolean) => void } {
  const sessionRestoreClaimed = useRef(false)
  const [sessionRestored, setSessionRestored] = useState(false)
  // STATE, not a ref: AtlasView's own landingPending reads it during
  // render, off limits for a ref (React Compiler's react-hooks/refs
  // rule). Declared before the session-restore effect below since that
  // effect's own async resolution can set it too.
  const [suppressAutoEntry, setSuppressAutoEntry] = useState(false)

  useEffect(() => {
    if (sessionRestoreClaimed.current) return
    sessionRestoreClaimed.current = true
    // A deep link owns the landing -- restore yields entirely (but
    // saves still arm, so the deep-linked position persists next).
    if (initialCardID) { setSessionRestored(true); return }
    AtlasService.AtlasSession()
      .then((session) => {
        if (session?.viewedID) setViewedID(session.viewedID)
        else if (session?.atRootExplicit) setSuppressAutoEntry(true)
        if (session?.openCardID) setOverlayCardID(session.openCardID)
        if (session?.activePerspectiveID) setActivePerspectiveID(session.activePerspectiveID)
      })
      .finally(() => setSessionRestored(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount landing, same as the deep-link claim
  }, [])

  useEffect(() => {
    if (!sessionRestored) return
    // atRootExplicit rides along only while genuinely at root -- the
    // one bit that lets a FUTURE restore tell a deliberate "All spaces"
    // landing apart from a session that was never saved.
    void AtlasService.SetAtlasSession({
      viewedID, openCardID: overlayCardID ?? '', activePerspectiveID,
      atRootExplicit: viewedID === '' && suppressAutoEntry,
    }).catch(() => {})
  }, [sessionRestored, viewedID, overlayCardID, activePerspectiveID, suppressAutoEntry])

  useEffect(() => {
    if (initialCardID || !cards || viewedID !== '' || !sessionRestored || suppressAutoEntry) return
    const root = singleRootCard(cards)
    if (root) setViewedID(root.ID)
  }, [cards, initialCardID, viewedID, sessionRestored, suppressAutoEntry, setViewedID])

  return { sessionRestored, suppressAutoEntry, setSuppressAutoEntry }
}
