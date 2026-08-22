package composition

import (
	"strings"
	"testing"
)

func TestExecAtlasFromReply(t *testing.T) {
	node := Node{Config: map[string]string{"itemsAttribute": "items", "outputAttribute": "created"}}

	t.Run("materializes via the injected function and stores the summary", func(t *testing.T) {
		restore := atlasReplyMaterializerFn
		defer func() { atlasReplyMaterializerFn = restore }()
		var got, gotParent string
		atlasReplyMaterializerFn = func(itemsJSON, parentID, sourceRunID string) (string, error) {
			got, gotParent = itemsJSON, parentID
			return `{"cards":1}`, nil
		}
		ctx := ExecContext{Attributes: map[string]any{"items": `[{"title":"CRM"}]`}}
		out, err := execAtlasFromReply(node, ctx)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != `[{"title":"CRM"}]` {
			t.Errorf("materializer received %q", got)
		}
		// No parentAttribute configured on this node -- parentID stays
		// "" (board root), the pre-existing default.
		if gotParent != "" {
			t.Errorf("parentID = %q, want empty with no parentAttribute configured", gotParent)
		}
		if out.Attributes["created"] != `{"cards":1}` {
			t.Errorf("summary not stored: %+v", out.Attributes)
		}
	})

	t.Run("a configured parentAttribute threads the landing space through", func(t *testing.T) {
		restore := atlasReplyMaterializerFn
		defer func() { atlasReplyMaterializerFn = restore }()
		var gotParent string
		atlasReplyMaterializerFn = func(_, parentID, _ string) (string, error) {
			gotParent = parentID
			return `{"cards":1}`, nil
		}
		parentNode := Node{Config: map[string]string{"itemsAttribute": "items", "parentAttribute": "parentId"}}
		ctx := ExecContext{Attributes: map[string]any{"items": `[{"title":"CRM"}]`, "parentId": "space-42"}}
		if _, err := execAtlasFromReply(parentNode, ctx); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotParent != "space-42" {
			t.Errorf("parentID = %q, want the configured attribute's value", gotParent)
		}
	})

	t.Run("missing attribute is a named error", func(t *testing.T) {
		_, err := execAtlasFromReply(node, ExecContext{Attributes: map[string]any{}})
		if err == nil || !strings.Contains(err.Error(), "no items") {
			t.Fatalf("expected a named no-items error, got %v", err)
		}
	})

	t.Run("non-array payload refused", func(t *testing.T) {
		_, err := execAtlasFromReply(node, ExecContext{Attributes: map[string]any{"items": `{"title":"x"}`}})
		if err == nil || !strings.Contains(err.Error(), "JSON array") {
			t.Fatalf("expected a named array error, got %v", err)
		}
	})

	t.Run("empty array refused", func(t *testing.T) {
		_, err := execAtlasFromReply(node, ExecContext{Attributes: map[string]any{"items": `[]`}})
		if err == nil || !strings.Contains(err.Error(), "empty") {
			t.Fatalf("expected a named empty error, got %v", err)
		}
	})

	t.Run("unwired materializer fails loudly", func(t *testing.T) {
		ctx := ExecContext{Attributes: map[string]any{"items": `[{"title":"x"}]`}}
		_, err := execAtlasFromReply(node, ctx)
		if err == nil || !strings.Contains(err.Error(), "no atlas reply materializer") {
			t.Fatalf("expected the unwired default to error, got %v", err)
		}
	})
}
