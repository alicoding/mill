package composition

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/adapters/aiclient"
)

func TestAIClassifyExec_RealCompleteRejectsInventedCategory(t *testing.T) {
	srv := fixtureOpenAIStructuredResultServer(t, `{"category":"invented"}`)
	withAIStubs(t, ResolvedAIProvider{
		Kind: "openai-compatible", BaseURL: srv.URL, Model: "fixture-model",
	}, aiclient.Complete)

	exec := lookupNodeType(t, "process-ai-classify")
	node := Node{ID: "n1", NodeTypeID: "process-ai-classify", Config: map[string]string{
		aiProviderIDConfigKey: "p1",
		"categories":          "urgent\nnormal",
		"outputAttribute":     "category",
	}}
	attributes := map[string]any{"category": "original"}
	_, err := exec(node, ExecContext{Attributes: attributes})
	if !errors.Is(err, aiclient.ErrInvalidStructuredResult) {
		t.Fatalf("exec error = %v, want ErrInvalidStructuredResult", err)
	}
	if attributes["category"] != "original" {
		t.Errorf("Attributes[category] = %v, want unchanged value %q", attributes["category"], "original")
	}
}
