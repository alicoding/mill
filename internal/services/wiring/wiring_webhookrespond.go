// The webhook door's reply half (goal 0373, split out of wiring.go at
// the 500-line convention): the one adapter closure between
// triggersvc's own WebhookWait/WebhookReply and bridgesvc's own --
// neither service package imports the other (bridgeservice_hooks.go's
// own SetWebhookEventSink doc comment), so this is where the two meet.

package wiring

import (
	"github.com/alicoding/mill/internal/services/bridgesvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// WireWebhookRespond arms the hook door to wait for a respond-webhook
// reply: DispatchWebhookEvent's own WebhookWait/WebhookReply shape is
// relayed onto bridgesvc's identically-shaped types, one goroutine per
// post, so a caller's one HTTP response can be answered by a run this
// package didn't start.
func WireWebhookRespond(bridge *bridgesvc.BridgeService, trigger *triggersvc.TriggerService) {
	bridge.SetWebhookEventSink(func(values map[string]string, raw []byte) *bridgesvc.WebhookWait {
		wait := trigger.DispatchWebhookEvent(values, raw)
		if wait == nil {
			return nil
		}
		relay := make(chan bridgesvc.WebhookReply, 1)
		go func() {
			r := <-wait.Reply
			relay <- bridgesvc.WebhookReply{Status: r.Status, ContentType: r.ContentType, Body: r.Body}
		}()
		return &bridgesvc.WebhookWait{Reply: relay, Budget: wait.Budget}
	})
}
