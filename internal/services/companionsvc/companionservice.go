// Package companionsvc is the Atlas AI companion's bound surface (goal
// 0101 slice 1): one streaming chat turn against a user-configured
// AIProvider, using the SAME clipboard-bridge contract (context
// envelope, reply schema/taxonomy) 0099 already established --
// conversational transport, identical plane. Holds no conversation
// state of its own: the frontend owns the transcript (the goal's own
// "closing the panel discards it" contract) and resends it whole on
// every turn, the same stateless-per-call shape every chat completion
// API already requires. A new package rather than an atlassvc
// addition -- atlassvc already spans 20+ files near CLAUDE.md's
// 500-line convention, and this is a genuinely new capability
// (conversational AI transport), not Atlas card/kind/link CRUD.
package companionsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// DeltaEventName is registered by main.go (application.RegisterEvent)
// and listened for in frontend/src/atlas/CompanionPanel.tsx via
// Events.On -- the one place this wire name should be spelled.
const DeltaEventName = "companion-delta"

// CompanionDelta is one incremental piece of the assistant's reply,
// emitted while SendMessage's call is still in flight -- the panel
// only ever has one send outstanding at a time (its composer disables
// while busy), so no correlation id travels with a delta.
type CompanionDelta struct {
	Text string `json:"text"`
}

// ChatMessage is one turn of the panel's own conversation history.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// CompanionReply is SendMessage's result: the complete streamed text,
// plus whatever the clipboard-bridge reply parser made of it.
// Preview.Recognized is false for ordinary conversational text (render
// Text as plain chat); true with Valid false for a reply that
// attempted the contract but failed it (render Text plus a "couldn't
// read this as actions" note); true with Valid true for a proposal the
// panel renders as a review card.
type CompanionReply struct {
	Text    string                          `json:"Text"`
	Preview atlassvc.ClipbridgeReplyPreview `json:"Preview"`
}

// CompanionService is goal 0101 slice 1's bound surface.
type CompanionService struct {
	atlas *atlassvc.AtlasService
}

// NewCompanionService wires the one dependency this service needs:
// AtlasService.PreviewClipbridgeReply, the SAME parse+collision path
// the quick-panel clipboard door uses, so a companion proposal and a
// pasted-reply proposal are never two code paths.
func NewCompanionService(atlas *atlassvc.AtlasService) *CompanionService {
	return &CompanionService{atlas: atlas}
}

// chatFn defaults to aiclient.Chat, a real streaming HTTP call
// (production's only path) -- overridable in tests (SetChatFn) so this
// service's own responsibility (resolving the provider, forwarding
// deltas as events, parsing the completed reply) can be proven without
// hitting real HTTP, the same seam shape composition.SetAICompleteFn
// already established for the ai-* node family.
var chatFn = aiclient.Chat

// SetChatFn overrides how SendMessage actually streams a completion --
// test-only; production always uses the default (aiclient.Chat).
func SetChatFn(fn func(aiclient.ChatRequest, func(string)) (aiclient.ChatResult, error)) {
	chatFn = fn
}

// deltaTestHook lets a test observe emitted deltas without a live
// Wails application (application.Get() returns nil under `go test`) --
// same seam shape as dataevent.TestHook. Package-level and shared
// across a test binary: a test that sets it must restore it to nil via
// t.Cleanup before returning.
var deltaTestHook func(text string)

// SetDeltaTestHook installs deltaTestHook -- test-only.
func SetDeltaTestHook(fn func(text string)) {
	deltaTestHook = fn
}

func emitDelta(text string) {
	if app := application.Get(); app != nil {
		app.Event.Emit(DeltaEventName, CompanionDelta{Text: text})
	}
	if deltaTestHook != nil {
		deltaTestHook(text)
	}
}

// SendMessage streams one chat turn against aiProviderID. system is the
// caller-assembled context -- AtlasService.SpaceContextEnvelope for a
// fresh turn, AtlasService.CorrectionEnvelope for a re-propose turn --
// the panel's own choice of which envelope to fetch, never decided in
// here. messages is the full conversation history including the
// just-typed user turn (the panel resends it whole every call; this
// service persists nothing). Progressive text arrives as
// DeltaEventName events while this call is in flight; the return value
// is the complete text plus its parsed reply preview.
func (c *CompanionService) SendMessage(aiProviderID, system string, messages []ChatMessage) (CompanionReply, error) {
	if aiProviderID == "" {
		return CompanionReply{}, fmt.Errorf("companion: no AI provider selected")
	}
	rp, err := composition.ResolveAIProvider(aiProviderID)
	if err != nil {
		return CompanionReply{}, fmt.Errorf("companion: %w", err)
	}

	chatMessages := make([]aiclient.ChatMessage, len(messages))
	for i, m := range messages {
		chatMessages[i] = aiclient.ChatMessage{Role: m.Role, Content: m.Content}
	}
	res, err := chatFn(aiclient.ChatRequest{
		Kind: aiclient.Kind(rp.Kind), BaseURL: rp.BaseURL, Model: rp.Model, APIKey: rp.APIKey,
		System: system, Messages: chatMessages,
	}, emitDelta)
	if err != nil {
		return CompanionReply{Text: res.Text}, fmt.Errorf("companion: %w", err)
	}

	preview, err := c.atlas.PreviewClipbridgeReply(res.Text)
	if err != nil {
		return CompanionReply{Text: res.Text}, fmt.Errorf("companion: %w", err)
	}
	return CompanionReply{Text: res.Text, Preview: preview}, nil
}
