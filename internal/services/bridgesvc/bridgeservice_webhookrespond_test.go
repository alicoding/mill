package bridgesvc_test

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/bridgesvc"
)

// TestWebhook_RespondingRun_WritesStatusBodyContentType proves the
// handler writes a delivered reply's own status/body/content-type
// verbatim, not a Mill-chosen shape.
func TestWebhook_RespondingRun_WritesStatusBodyContentType(t *testing.T) {
	fixture := newWebhookFixture(t)
	reply := make(chan bridgesvc.WebhookReply, 1)
	reply <- bridgesvc.WebhookReply{Status: 201, ContentType: "text/plain", Body: "hi"}
	fixture.setWait(&bridgesvc.WebhookWait{Reply: reply, Budget: 5 * time.Second})

	status, header, body := fixture.postFull(t)
	if status != 201 {
		t.Errorf("status = %d, want 201", status)
	}
	if header.Get("Content-Type") != "text/plain" {
		t.Errorf("Content-Type = %q, want %q", header.Get("Content-Type"), "text/plain")
	}
	if header.Get("Mill-Reply") != "" {
		t.Errorf("Mill-Reply = %q, want unset for a real reply", header.Get("Mill-Reply"))
	}
	if string(body) != "hi" {
		t.Errorf("body = %q, want %q", body, "hi")
	}
}

// TestWebhook_BudgetElapsed_StandardBodyWithHeader proves goal 0373
// design contract item 3: nobody answered before the budget, so the
// caller gets the standard body plus the Mill-Reply: none header.
func TestWebhook_BudgetElapsed_StandardBodyWithHeader(t *testing.T) {
	fixture := newWebhookFixture(t)
	reply := make(chan bridgesvc.WebhookReply) // never sent
	fixture.setWait(&bridgesvc.WebhookWait{Reply: reply, Budget: 30 * time.Millisecond})

	status, header, body := fixture.postFull(t)
	if status != 200 {
		t.Errorf("status = %d, want 200", status)
	}
	if header.Get("Mill-Reply") != "none" {
		t.Errorf("Mill-Reply = %q, want %q", header.Get("Mill-Reply"), "none")
	}
	if string(body) != `{"reply":"none"}` {
		t.Errorf("body = %q, want the standard body", body)
	}
}

// TestWebhook_PromptNoReply_StandardBodyNoHeaderNoWait proves the
// OTHER half of item 3: a run that finished without ever answering
// gets the SAME standard body, but promptly (never waiting out the
// budget) and with NO Mill-Reply header -- the header names only the
// budget-elapsed case.
func TestWebhook_PromptNoReply_StandardBodyNoHeaderNoWait(t *testing.T) {
	fixture := newWebhookFixture(t)
	reply := make(chan bridgesvc.WebhookReply, 1)
	reply <- bridgesvc.WebhookReply{Status: 0} // the "nobody replied" sentinel
	fixture.setWait(&bridgesvc.WebhookWait{Reply: reply, Budget: 10 * time.Second})

	start := time.Now()
	status, header, body := fixture.postFull(t)
	elapsed := time.Since(start)
	if status != 200 {
		t.Errorf("status = %d, want 200", status)
	}
	if header.Get("Mill-Reply") != "" {
		t.Errorf("Mill-Reply = %q, want unset (only the budget-elapsed case sets it)", header.Get("Mill-Reply"))
	}
	if string(body) != `{"reply":"none"}` {
		t.Errorf("body = %q, want the standard body", body)
	}
	if elapsed >= 10*time.Second {
		t.Errorf("took %v, want well under the 10s budget", elapsed)
	}
}

// TestWebhook_NilWait_ACKsExactlyAsBefore proves goal 0373 design
// contract item 3's "byte-identical" requirement: a nil wait (no
// started run's graph contains a respond-webhook node) never touches
// the response beyond today's plain 202.
func TestWebhook_NilWait_ACKsExactlyAsBefore(t *testing.T) {
	fixture := newWebhookFixture(t)
	// fixture.wait stays nil -- the default.
	status, header, body := fixture.postFull(t)
	if status != 202 {
		t.Errorf("status = %d, want 202", status)
	}
	if len(body) != 0 {
		t.Errorf("body = %q, want empty", body)
	}
	if header.Get("Mill-Reply") != "" {
		t.Errorf("Mill-Reply = %q, want unset", header.Get("Mill-Reply"))
	}
}
