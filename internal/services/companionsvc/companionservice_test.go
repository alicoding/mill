package companionsvc

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// stubChat installs a fake chatFn returning reply (streamed as one
// delta) or err, restoring the real aiclient.Chat via t.Cleanup so
// this test's fake never leaks into another test in the package.
func stubChat(t *testing.T, reply string, err error) *[]string {
	t.Helper()
	var deltas []string
	SetChatFn(func(req aiclient.ChatRequest, onDelta func(string)) (string, error) {
		if err != nil {
			return "", err
		}
		onDelta(reply)
		return reply, nil
	})
	SetDeltaTestHook(func(text string) { deltas = append(deltas, text) })
	t.Cleanup(func() {
		SetChatFn(aiclient.Chat)
		SetDeltaTestHook(nil)
	})
	return &deltas
}

func stubProvider(t *testing.T) {
	t.Helper()
	composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
		if id != "test-provider" {
			return composition.ResolvedAIProvider{}, errors.New("no such provider")
		}
		return composition.ResolvedAIProvider{Kind: "openai-compatible", BaseURL: "http://example.invalid", Model: "m"}, nil
	})
	t.Cleanup(func() {
		composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
			return composition.ResolvedAIProvider{}, errors.New("no AI provider lookup registered (yet)")
		})
	})
}

func newTestCompanionService() *CompanionService {
	return NewCompanionService(atlassvc.NewAtlasService(servicetest.NewFakeStore()))
}

func TestSendMessage_NoProviderSelected_Errors(t *testing.T) {
	c := newTestCompanionService()
	if _, err := c.SendMessage("", "", nil); err == nil {
		t.Fatal("expected an error when no AI provider is selected")
	}
}

func TestSendMessage_UnknownProvider_Errors(t *testing.T) {
	stubProvider(t)
	c := newTestCompanionService()
	if _, err := c.SendMessage("does-not-exist", "", nil); err == nil {
		t.Fatal("expected an error for an unresolvable provider id")
	}
}

func TestSendMessage_PlainConversation_NotRecognizedAsAReply(t *testing.T) {
	stubProvider(t)
	stubChat(t, "Sure, here's what I found.", nil)
	c := newTestCompanionService()
	reply, err := c.SendMessage("test-provider", "system context", []ChatMessage{{Role: "user", Content: "hi"}})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if reply.Preview.Recognized {
		t.Fatalf("plain prose should not be recognized as a reply: %+v", reply.Preview)
	}
	if reply.Text != "Sure, here's what I found." {
		t.Errorf("Text = %q", reply.Text)
	}
}

func TestSendMessage_ValidCreateCardsReply_ParsesAsProposal(t *testing.T) {
	stubProvider(t)
	reply := `{"mill":1,"kind":"reply","action":"create-cards","items":[{"title":"New card"}]}`
	deltas := stubChat(t, reply, nil)
	c := newTestCompanionService()
	got, err := c.SendMessage("test-provider", "system context", []ChatMessage{{Role: "user", Content: "make a card"}})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if !got.Preview.Recognized || !got.Preview.Valid {
		t.Fatalf("expected a valid, recognized proposal: %+v", got.Preview)
	}
	if len(got.Preview.Cards) != 1 || got.Preview.Cards[0].Draft.Title != "New card" {
		t.Fatalf("Cards = %+v", got.Preview.Cards)
	}
	if len(*deltas) != 1 || (*deltas)[0] != reply {
		t.Errorf("emitted deltas = %v, want the streamed reply as one delta", *deltas)
	}
}

func TestSendMessage_InvalidReply_RecognizedButNotValid(t *testing.T) {
	stubProvider(t)
	stubChat(t, `{"mill":1,"kind":"reply","action":"create-cards","items":[{"note":"no title"}]}`, nil)
	c := newTestCompanionService()
	got, err := c.SendMessage("test-provider", "system context", []ChatMessage{{Role: "user", Content: "x"}})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if !got.Preview.Recognized || got.Preview.Valid {
		t.Fatalf("expected a recognized-but-invalid preview: %+v", got.Preview)
	}
}

func TestSendMessage_ChatError_Propagates(t *testing.T) {
	stubProvider(t)
	stubChat(t, "", errors.New("provider unreachable"))
	c := newTestCompanionService()
	if _, err := c.SendMessage("test-provider", "", nil); err == nil {
		t.Fatal("expected the chat error to propagate")
	}
}
