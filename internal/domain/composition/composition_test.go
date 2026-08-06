package composition

import (
	"errors"
	"strings"
	"testing"
)

func withFakeClipboard(t *testing.T, read func() (string, error), writeHTML, writeText func(string) error) {
	t.Helper()
	origRead, origWriteHTML, origWriteText := readClipboardHTML, writeClipboardHTML, writeClipboardText
	if read != nil {
		readClipboardHTML = read
	}
	if writeHTML != nil {
		writeClipboardHTML = writeHTML
	}
	if writeText != nil {
		writeClipboardText = writeText
	}
	t.Cleanup(func() {
		readClipboardHTML = origRead
		writeClipboardHTML = origWriteHTML
		writeClipboardText = origWriteText
	})
}

func TestNodeTypes(t *testing.T) {
	types := NodeTypes()
	if len(types) == 0 {
		t.Fatal("NodeTypes() returned no node types")
	}
	seen := make(map[string]bool)
	for _, nt := range types {
		if nt.ID == "" || nt.Label == "" || nt.Description == "" {
			t.Errorf("node type %+v has an empty ID/Label/Description", nt)
		}
		if seen[nt.ID] {
			t.Errorf("duplicate node type ID %q", nt.ID)
		}
		seen[nt.ID] = true
	}
}

func TestRecipes_ReferenceRealNodeTypes(t *testing.T) {
	known := make(map[string]bool)
	for _, nt := range NodeTypes() {
		known[nt.ID] = true
	}
	for _, r := range Recipes() {
		if r.ID == "" || r.Label == "" {
			t.Errorf("recipe %+v has an empty ID/Label", r)
		}
		if len(r.NodeIDs) == 0 {
			t.Errorf("recipe %q has no nodes", r.ID)
		}
		for _, nodeID := range r.NodeIDs {
			if !known[nodeID] {
				t.Errorf("recipe %q references unknown node type %q", r.ID, nodeID)
			}
		}
	}
}

func TestRunRecipe_UnknownRecipe(t *testing.T) {
	if _, err := RunRecipe("does-not-exist"); err == nil {
		t.Fatal("RunRecipe(unknown id) returned nil error, want an error")
	}
}

func TestRunRecipe_LoadSampleHTML(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, nil)

	result, err := RunRecipe("load-sample-html-recipe")
	if err != nil {
		t.Fatalf("RunRecipe(load-sample-html-recipe) returned error: %v", err)
	}
	if written != sampleHTML {
		t.Errorf("apply-clipboard-write-html was called with %q, want the sample HTML", written)
	}
	if !strings.Contains(result, "Quarterly update") {
		t.Errorf("RunRecipe(load-sample-html-recipe) result = %q, want it to contain the sample HTML", result)
	}
}

func TestRunRecipe_ClipboardHTMLToMarkdown(t *testing.T) {
	var written string
	withFakeClipboard(t, func() (string, error) {
		return "<h2>Hi</h2><p>the <strong>bit</strong></p>", nil
	}, nil, func(md string) error {
		written = md
		return nil
	})

	result, err := RunRecipe("clipboard-html-to-markdown-recipe")
	if err != nil {
		t.Fatalf("RunRecipe(clipboard-html-to-markdown-recipe) returned error: %v", err)
	}
	if !strings.Contains(result, "## Hi") || !strings.Contains(result, "**bit**") {
		t.Errorf("RunRecipe(clipboard-html-to-markdown-recipe) result = %q, want converted markdown", result)
	}
	if written != result {
		t.Errorf("apply-clipboard-write-text was called with %q, want it to match the returned markdown %q", written, result)
	}
}

func TestRunRecipe_ClipboardHTMLToMarkdown_NoHTMLOnClipboard(t *testing.T) {
	withFakeClipboard(t, func() (string, error) {
		return "", errors.New("no HTML on clipboard")
	}, nil, nil)

	// Unlike internal/domain/runbook's soft-failure path (nil error,
	// friendly explanation), this prototype's node executor surfaces a
	// plain error -- documented as a deliberate simplification in
	// composition.go's RunRecipe doc comment, confirmed here so it isn't
	// mistaken for a bug later.
	if _, err := RunRecipe("clipboard-html-to-markdown-recipe"); err == nil {
		t.Fatal("RunRecipe(clipboard-html-to-markdown-recipe) with no clipboard HTML returned nil error, want an error (plain-error prototype behavior, unlike runbook's soft-failure)")
	}
}
