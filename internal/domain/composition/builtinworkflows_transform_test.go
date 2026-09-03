package composition

import "testing"

// The seed, executed through the real path with the clipboard seams
// stubbed: what lands on the clipboard is the SHA-256 of what was there.
func TestSeededSha256Clipboard_HashesTheClipboardTextEndToEnd(t *testing.T) {
	origRead, origWrite := readClipboardText, writeClipboardText
	t.Cleanup(func() { readClipboardText, writeClipboardText = origRead, origWrite })
	readClipboardText = func() (string, error) { return "abc", nil }
	var written string
	writeClipboardText = func(s string) error { written = s; return nil }

	var seed *Workflow
	for _, w := range BuiltInWorkflows() {
		if w.ID == ExampleSha256ClipboardWorkflowID {
			wf := w
			seed = &wf
		}
	}
	if seed == nil {
		t.Fatal("seed missing from BuiltInWorkflows")
	}
	if _, err := ExecuteWorkflow(seed.Nodes, seed.Edges, nil); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if written != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Errorf("clipboard now holds %q", written)
	}
}
