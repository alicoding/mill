package atlassvc

import "github.com/alicoding/mill/internal/domain/atlas"

// cardChangeSinkFn is atlassvc's card-change seam for trigger-atlas-card
// (goal 0066) -- mirrors workflowRunner's own injected-function shape
// (atlasservice_run.go): atlassvc never imports triggersvc, the
// dependency runs the other way via main.go wiring SetCardChangeSink to
// TriggerService.DispatchAtlasCardChange. Nil until wired (every
// standalone atlassvc test) -- notifyCardChange below is a no-op then.
var cardChangeSinkFn func(cardID, kindID, title, changeType, sourceRunID string)

// SetCardChangeSink installs the seam -- called once from main.go once
// TriggerService exists.
//
//wails:ignore
func SetCardChangeSink(fn func(cardID, kindID, title, changeType, sourceRunID string)) {
	cardChangeSinkFn = fn
}

// notifyCardChange fires the card-change seam for c's create/update,
// best-effort (there's no request this could return an error to, same
// posture UpdateNow's own NotifyRunCompleted already takes). sourceRunID
// is the writing run's own id, "" for a manual Atlas UI edit/import --
// forwarded opaquely; the cycle-guard decision itself lives at
// TriggerService's own dispatch point (docs/goals/0066), never here.
func (a *AtlasService) notifyCardChange(c atlas.Card, changeType, sourceRunID string) {
	if cardChangeSinkFn == nil {
		return
	}
	cardChangeSinkFn(c.ID, c.KindID, c.Title, changeType, sourceRunID)
}
