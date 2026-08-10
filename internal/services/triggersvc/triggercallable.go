package triggersvc

// trigger-callable needs no live listener -- a callable workflow only
// ever fires when a parent's child-workflow step invokes it
// (docs/adr/0010), never from an external event. Same nil-listener
// shape as trigger-manual. This dispatch half was missing entirely
// until ADR-0021's Sync change armed listeners for every published
// workflow: the seeded callable child is published, so every Sync
// logged "unknown trigger node type: trigger-callable" -- harmless but
// wrong, caught from real server logs during the tab-shell e2e run.
func init() {
	RegisterTrigger("trigger-callable", func(_ *TriggerService, _ string, _ map[string]string) (*activeListener, error) {
		return nil, nil
	})
}
