package settingssvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
)

// Cross-device forward (docs/goals/0023-attention-escalation.md item
// 4): an optional Configure-authored HTTPRequest (ntfy/Telegram/a
// generic webhook receiver/etc -- §1.1-clean, the user brings their own
// connector) fired on every NEW pending item, independent of the
// away/idle presence gate in settingsservice_attention.go -- this is
// the only layer that reaches the owner entirely away from the work
// machine (no local Mac to show an OS notification or a floating
// prompt on at all).

// forwardApprovalsEnabledKey / forwardApprovalsRequestIDKey persist the
// forward's own config -- default off (fail-safe toward no new egress,
// §1.1: zero outbound calls the user didn't explicitly configure) and
// unconfigured, same shape every other opt-in Settings toggle here
// already uses.
const (
	forwardApprovalsEnabledKey   = "settings-forward-approvals-enabled"
	forwardApprovalsRequestIDKey = "settings-forward-approvals-request-id"
)

// GetForwardApprovalsEnabled reports whether the forward is armed.
func (s *SettingsService) GetForwardApprovalsEnabled() bool {
	v, ok := s.store.Get(forwardApprovalsEnabledKey).(string)
	return ok && v == "true"
}

// SetForwardApprovalsEnabled persists the toggle, returning the persist
// error (same reasoning as every other settings toggle here: a save
// that silently didn't take effect leaves the user believing the
// forward is armed when it isn't, or vice versa).
func (s *SettingsService) SetForwardApprovalsEnabled(enabled bool) error {
	val := "false"
	if enabled {
		val = "true"
	}
	if err := s.store.Set(forwardApprovalsEnabledKey, val); err != nil {
		return fmt.Errorf("save forward-approvals toggle: %w", err)
	}
	return nil
}

// GetForwardApprovalsRequestID returns the configured HTTPRequest's ID
// (empty means unconfigured).
func (s *SettingsService) GetForwardApprovalsRequestID() string {
	v, _ := s.store.Get(forwardApprovalsRequestIDKey).(string)
	return v
}

// SetForwardApprovalsRequestID persists which Configure-authored
// HTTPRequest to forward pending-approval events through.
func (s *SettingsService) SetForwardApprovalsRequestID(id string) error {
	if err := s.store.Set(forwardApprovalsRequestIDKey, id); err != nil {
		return fmt.Errorf("save forward-approvals request id: %w", err)
	}
	return nil
}

// forwardApprovalPayload is the JSON body sent to the configured
// HTTPRequest -- REPLACES that request's own body (composition.SendJSONWebhook's
// own contract), the same "the computed JSON becomes the whole body"
// mechanism decisionoutcome.go's webhook already establishes, never
// appended to whatever the request's own Body field carries.
type forwardApprovalPayload struct {
	Kind        string    `json:"kind"`
	ID          string    `json:"id"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ForwardPendingApproval fires the configured cross-device forward for
// one new pending item -- fire-and-forget: it returns immediately, and
// a delivery failure is only slog-logged, never surfaced back to the
// caller or allowed to block anything. App.tsx's own per-new-item loop
// calls this alongside NotifyPendingApproval, unconditionally --
// unlike the presence gate, forwarding doesn't depend on local
// focus/idle at all, since the whole point is reaching the owner when
// there may be no local Mac attention to gate on in the first place.
func (s *SettingsService) ForwardPendingApproval(id, description, kind string) {
	requestID := s.GetForwardApprovalsRequestID()
	if !s.GetForwardApprovalsEnabled() || requestID == "" {
		return
	}
	go func() {
		if err := s.forwardPendingApprovalNow(requestID, id, description, kind); err != nil {
			slog.Error("forward pending approval", "id", id, "kind", kind, "error", err)
		}
	}()
}

// forwardPendingApprovalNow does the actual send, split out of
// ForwardPendingApproval specifically so a test can call it
// synchronously (no goroutine timing to race against) while production
// code stays fire-and-forget.
func (s *SettingsService) forwardPendingApprovalNow(requestID, id, description, kind string) error {
	body, err := json.Marshal(forwardApprovalPayload{Kind: kind, ID: id, Description: description, CreatedAt: time.Now().UTC()})
	if err != nil {
		return fmt.Errorf("encode forward-approval body: %w", err)
	}
	_, err = composition.SendJSONWebhook(requestID, string(body))
	return err
}
