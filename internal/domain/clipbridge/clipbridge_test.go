package clipbridge

import (
	"encoding/json"
	"strings"
	"testing"
)

var testKinds = []string{"Topic", "Contact", "Document", "Component"}

func validReply(t *testing.T, action string, items string) string {
	t.Helper()
	return `{"mill":1,"kind":"reply","action":"` + action + `","items":` + items + `}`
}

func TestBuildContextEnvelope(t *testing.T) {
	env, err := BuildContextEnvelope([]ContextCard{{Title: "Web app", Kind: "Component"}}, testKinds, V1Actions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if env.Mill != EnvelopeVersion || env.Kind != KindContext {
		t.Errorf("marker fields wrong: %+v", env)
	}
	if len(env.Items) != 1 || len(env.AllowedActions) != 2 {
		t.Errorf("items/actions wrong: %+v", env)
	}
	if env.Instructions == "" {
		t.Error("the one-line reply instruction is missing")
	}
	// The whole envelope must round-trip as one JSON object.
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("envelope is not one valid JSON object: %v", err)
	}
	for _, key := range []string{"mill", "kind", "instructions", "schema", "allowedActions", "items"} {
		if _, ok := back[key]; !ok {
			t.Errorf("envelope lost key %q", key)
		}
	}
}

// The portable-subset guard: the reply schema's keyword vocabulary must
// stay inside the locked structured-output intersection. A keyword
// outside the allowlist appearing anywhere in the schema fails this
// test -- widening the vocabulary is a deliberate contract change, not
// a drive-by.
func TestReplySchema_KeywordsStayInsidePortableSubset(t *testing.T) {
	allowed := map[string]bool{
		"$schema": true, "$defs": true, "$ref": true,
		"type": true, "properties": true, "required": true,
		"additionalProperties": true, "enum": true, "items": true,
	}
	raw, err := ReplySchema(testKinds, V1Actions())
	if err != nil {
		t.Fatalf("ReplySchema: %v", err)
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	var walk func(v any, inProperties bool)
	walk = func(v any, inProperties bool) {
		switch node := v.(type) {
		case map[string]any:
			for k, child := range node {
				if !inProperties && !allowed[k] {
					t.Errorf("schema keyword %q is outside the portable subset", k)
				}
				// Values under "properties"/"$defs" are NAMES, not
				// keywords; their children are schemas again.
				walk(child, k == "properties" || k == "$defs")
			}
		case []any:
			for _, child := range node {
				walk(child, false)
			}
		}
	}
	walk(doc, false)
}

func TestParseReply_CreateCards(t *testing.T) {
	p := ParseReply(validReply(t, ActionCreateCards, `[{"title":"CRM","kind":"Component","note":"vendor system"}]`), testKinds, V1Actions())
	if !p.Recognized || !p.Valid {
		t.Fatalf("expected a valid reply, got %+v", p)
	}
	if p.Class != ClassCreate || len(p.Cards) != 1 || p.Cards[0].Title != "CRM" {
		t.Errorf("parse result wrong: %+v", p)
	}
}

func TestParseReply_FencedJSONIsTolerated(t *testing.T) {
	fenced := "```json\n" + validReply(t, ActionCreateCards, `[{"title":"CRM"}]`) + "\n```"
	p := ParseReply(fenced, testKinds, V1Actions())
	if !p.Valid {
		t.Fatalf("fenced reply should validate, got %+v", p)
	}
}

func TestParseReply_RefusalsNameThemselves(t *testing.T) {
	t.Run("not an envelope at all", func(t *testing.T) {
		p := ParseReply("just some prose", testKinds, V1Actions())
		if p.Recognized {
			t.Fatalf("prose must not be recognized: %+v", p)
		}
	})
	t.Run("wrong version", func(t *testing.T) {
		p := ParseReply(`{"mill":2,"kind":"reply","action":"create-cards","items":[]}`, testKinds, V1Actions())
		if !p.Recognized || p.Valid || len(p.Errors) == 0 || !strings.Contains(p.Errors[0], "version") {
			t.Fatalf("expected a version refusal, got %+v", p)
		}
	})
	t.Run("unknown action refused by the schema enum", func(t *testing.T) {
		p := ParseReply(validReply(t, "delete-everything", `[{"title":"x"}]`), testKinds, V1Actions())
		if p.Valid {
			t.Fatalf("unknown action must not validate: %+v", p)
		}
		if p.Class != ClassUnknown {
			t.Errorf("unknown action must classify unknown, got %q", p.Class)
		}
	})
	t.Run("card without title", func(t *testing.T) {
		p := ParseReply(validReply(t, ActionCreateCards, `[{"note":"no title"}]`), testKinds, V1Actions())
		if p.Valid || len(p.Errors) == 0 || !strings.Contains(p.Errors[0], "title") {
			t.Fatalf("expected a named title refusal, got %+v", p)
		}
	})
	t.Run("stray item field refused by additionalProperties", func(t *testing.T) {
		p := ParseReply(validReply(t, ActionCreateCards, `[{"title":"x","payload":"smuggled"}]`), testKinds, V1Actions())
		if p.Valid {
			t.Fatalf("stray fields must not validate: %+v", p)
		}
	})
	t.Run("unknown kind refused by the kind enum", func(t *testing.T) {
		p := ParseReply(validReply(t, ActionCreateCards, `[{"title":"x","kind":"Missile"}]`), testKinds, V1Actions())
		if p.Valid {
			t.Fatalf("unknown kind must not validate: %+v", p)
		}
	})
	t.Run("empty items", func(t *testing.T) {
		p := ParseReply(validReply(t, ActionCreateCards, `[]`), testKinds, V1Actions())
		if p.Valid || len(p.Errors) == 0 {
			t.Fatalf("empty items must be refused with a named error, got %+v", p)
		}
	})
}

func TestParseReply_NoteToScratchpad(t *testing.T) {
	p := ParseReply(validReply(t, ActionNoteToScratchpad, `[{"text":"remember this"}]`), testKinds, V1Actions())
	if !p.Valid || len(p.NoteTexts) != 1 || p.NoteTexts[0] != "remember this" {
		t.Fatalf("expected one note text, got %+v", p)
	}
}

// The hard cap in code: replace/delete classes may never auto-run, and
// everything that writes requires review.
func TestTaxonomyHardCap(t *testing.T) {
	if MayAutoRun(ClassReplace) || MayAutoRun(ClassDelete) || MayAutoRun(ClassCreate) || MayAutoRun(ClassUnknown) {
		t.Fatal("only read-class may auto-run")
	}
	if !MayAutoRun(ClassRead) {
		t.Fatal("read-class is allowed agentically")
	}
	for _, c := range []ActionClass{ClassCreate, ClassReplace, ClassDelete, ClassUnknown} {
		if !RequiresReview(c) {
			t.Fatalf("class %q must require review", c)
		}
	}
}

// A round-trip through the emitted schema: a reply an AI would produce
// from the envelope validates; the envelope itself does NOT validate as
// a reply (the two shapes stay distinguishable).
func TestEnvelopeAndReplyStayDistinguishable(t *testing.T) {
	env, err := BuildContextEnvelope([]ContextCard{{Title: "A", Kind: "Topic"}}, testKinds, V1Actions())
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	raw, _ := json.Marshal(env)
	p := ParseReply(string(raw), testKinds, V1Actions())
	if !p.Recognized {
		t.Fatal("an envelope still carries the mill marker")
	}
	if p.Valid {
		t.Fatal("a context envelope must not validate as a reply")
	}
}

// Regression (CodeQL: unsafe quoting class): a kind label carrying
// quotes/JSON metacharacters must land as an inert enum VALUE -- it can
// never alter the schema document's structure, because the schema is
// built structurally, not by string formatting.
func TestReplySchema_HostileLabelsStayInert(t *testing.T) {
	hostile := `x"],"$ref":"https://evil.example/schema"}//`
	raw, err := ReplySchema([]string{hostile, "Topic"}, V1Actions())
	if err != nil {
		t.Fatalf("ReplySchema: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("schema no longer parses: %v", err)
	}
	defs := doc["$defs"].(map[string]any)["item"].(map[string]any)
	kindEnum := defs["properties"].(map[string]any)["kind"].(map[string]any)["enum"].([]any)
	if len(kindEnum) != 2 || kindEnum[0] != hostile {
		t.Fatalf("hostile label mangled or lost: %v", kindEnum)
	}
	if strings.Contains(string(raw), "evil.example\"}") {
		t.Fatal("label content escaped its enum string")
	}
}
