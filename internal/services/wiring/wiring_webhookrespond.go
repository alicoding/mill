// The webhook door's reply half (goal 0373, split out of wiring.go at
// the 500-line convention): the one adapter closure between
// triggersvc's own WebhookWait/WebhookReply and bridgesvc's own --
// neither service package imports the other (bridgeservice_hooks.go's
// own SetWebhookEventSink doc comment), so this is where the two meet.

package wiring

import (
	"time"

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
		return relayWebhookWait(trigger.DispatchWebhookEvent(values, raw))
	})
}

// relayWebhookWait adapts triggersvc's own WebhookWait/WebhookReply
// onto bridgesvc's identically-shaped types, one goroutine per post --
// split out of WireWebhookRespond so the leak this goroutine must NOT
// have is unit-testable without a real TriggerService/BridgeService.
func relayWebhookWait(wait *triggersvc.WebhookWait) *bridgesvc.WebhookWait {
	if wait == nil {
		return nil
	}
	relay := make(chan bridgesvc.WebhookReply, 1)
	go func() {
		// Bounded by the SAME budget bridgesvc's own handler already
		// waits on: a listener still parked past the budget never
		// sends anything on wait.Reply (goal 0373 design contract item
		// 5), and this goroutine must not outlive the HTTP response it
		// exists to feed.
		select {
		case r := <-wait.Reply:
			relay <- bridgesvc.WebhookReply{Status: r.Status, ContentType: r.ContentType, Body: r.Body}
		case <-time.After(wait.Budget):
		}
	}()
	return &bridgesvc.WebhookWait{Reply: relay, Budget: wait.Budget}
}
