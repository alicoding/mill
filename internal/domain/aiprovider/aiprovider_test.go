package aiprovider

import "testing"

func TestValidate_RejectsEmptyLabel(t *testing.T) {
	err := Validate(AIProvider{Kind: KindOpenAICompat, BaseURL: "http://localhost:11434", Model: "llama3.2"})
	if err == nil {
		t.Fatal("expected an error for an empty label, got nil")
	}
}

func TestValidate_RejectsUnknownKind(t *testing.T) {
	err := Validate(AIProvider{Label: "x", Kind: Kind("bogus"), Model: "m"})
	if err == nil {
		t.Fatal("expected an error for an unknown kind, got nil")
	}
}

func TestValidate_RejectsEmptyModel(t *testing.T) {
	err := Validate(AIProvider{Label: "x", Kind: KindAnthropic})
	if err == nil {
		t.Fatal("expected an error for an empty model, got nil")
	}
}

func TestValidate_OpenAICompatRequiresBaseURL(t *testing.T) {
	err := Validate(AIProvider{Label: "x", Kind: KindOpenAICompat, Model: "llama3.2"})
	if err == nil {
		t.Fatal("expected an error for a blank base URL on an openai-compatible provider, got nil")
	}
}

func TestValidate_AnthropicAllowsBlankBaseURL(t *testing.T) {
	err := Validate(AIProvider{Label: "Claude", Kind: KindAnthropic, Model: "claude-sonnet-4-5"})
	if err != nil {
		t.Fatalf("expected a blank base URL to be legal for an anthropic provider (resolves to %s at call time), got: %v", DefaultAnthropicBaseURL, err)
	}
}

func TestValidate_AcceptsFullyPopulatedProvider(t *testing.T) {
	err := Validate(AIProvider{Label: "Local Ollama", Kind: KindOpenAICompat, BaseURL: "http://localhost:11434", Model: "llama3.2"})
	if err != nil {
		t.Fatalf("Validate rejected a fully-populated, valid provider: %v", err)
	}
}

func TestBuiltIn_ValidatesClean(t *testing.T) {
	for _, p := range BuiltIn() {
		if err := Validate(p); err != nil {
			t.Errorf("seeded provider %q fails Validate: %v", p.ID, err)
		}
	}
}
