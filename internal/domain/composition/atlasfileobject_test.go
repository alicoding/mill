package composition

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// stubFileObjectCreator swaps the atlas seam for the duration of one
// test, counting calls so a case that must NEVER reach atlassvc (no
// bytes, too large) can assert exactly that.
func stubFileObjectCreator(t *testing.T, fn func(base64Data, filename, sourceRunID string) (AtlasFileObjectResult, error)) *struct{ calls int } {
	t.Helper()
	seen := &struct{ calls int }{}
	SetAtlasFileObjectCreator(func(base64Data, filename, sourceRunID string) (AtlasFileObjectResult, error) {
		seen.calls++
		return fn(base64Data, filename, sourceRunID)
	})
	t.Cleanup(func() {
		SetAtlasFileObjectCreator(func(_, _, _ string) (AtlasFileObjectResult, error) {
			return AtlasFileObjectResult{}, errors.New("no atlas file-object creator registered (yet)")
		})
	})
	return seen
}

func fileObjectInputPayload(t *testing.T, downloads []browserbridge.Download) string {
	t.Helper()
	return mustEncode(browserReplayOutput{
		Steps:     []browserReplayOutputStep{{Index: 0, Status: browserbridge.StatusOK}},
		Extracted: map[string]string{},
		Downloads: downloads,
	})
}

func decodeFileObjectOutput(t *testing.T, payload string) atlasFileObjectOutput {
	t.Helper()
	var out atlasFileObjectOutput
	if err := json.Unmarshal([]byte(payload), &out); err != nil {
		t.Fatalf("the step's own output is not readable JSON: %v", err)
	}
	return out
}

func TestExecAtlasFileObject_HappyPath_LandsTheDownloadAsAnObject(t *testing.T) {
	// currentRunID degrades to "" with no SetCurrentRunIDLookup wired
	// (its own doc comment) -- the same honest-default every other
	// unit test in this package that never wires ExecutionService
	// accepts; sourceRunID threading end to end is executionsvc's own
	// integration test (browserreplay_seed_test.go's shape).
	stub := stubFileObjectCreator(t, func(data, filename, runID string) (AtlasFileObjectResult, error) {
		if data == "" || filename != "quarterly.pdf" || runID != "" {
			t.Errorf("atlassvc seam called with (%q, %q, %q)", data, filename, runID)
		}
		return AtlasFileObjectResult{ObjectID: "atlas-object-1"}, nil
	})
	payload := fileObjectInputPayload(t, []browserbridge.Download{
		{Path: "/downloads/quarterly.pdf", Filename: "quarterly.pdf", Bytes: 4, Data: "YWJjZA=="},
	})

	ctx, err := execAtlasFileObject(Node{}, ExecContext{Payload: payload})
	if err != nil {
		t.Fatalf("execAtlasFileObject: %v", err)
	}
	if stub.calls != 1 {
		t.Errorf("atlassvc seam called %d times, want 1", stub.calls)
	}
	out := decodeFileObjectOutput(t, ctx.Payload)
	if len(out.Downloads) != 1 {
		t.Fatalf("Downloads has %d entries, want 1", len(out.Downloads))
	}
	got := out.Downloads[0]
	if got.ObjectID != "atlas-object-1" {
		t.Errorf("ObjectID = %q, want the seam's returned id", got.ObjectID)
	}
	if got.Note != "" {
		t.Errorf("Note = %q, want empty on a fresh landing", got.Note)
	}
	if got.Path != "/downloads/quarterly.pdf" || got.Filename != "quarterly.pdf" || got.Bytes != 4 {
		t.Errorf("got = %+v, want the browser's own path/filename/bytes to survive unchanged", got)
	}
	if len(out.Steps) != 1 {
		t.Errorf("Steps has %d entries, want the input's 1 to pass through unchanged", len(out.Steps))
	}
}

func TestExecAtlasFileObject_DuplicateHit_NamesWhenItFirstLanded(t *testing.T) {
	stubFileObjectCreator(t, func(string, string, string) (AtlasFileObjectResult, error) {
		return AtlasFileObjectResult{ObjectID: "atlas-object-1", Note: "Already on the board since run run-0 (2026-09-01 10:00)."}, nil
	})
	payload := fileObjectInputPayload(t, []browserbridge.Download{
		{Path: "/downloads/quarterly.pdf", Filename: "quarterly.pdf", Bytes: 4, Data: "YWJjZA=="},
	})

	ctx, err := execAtlasFileObject(Node{}, ExecContext{Payload: payload})
	if err != nil {
		t.Fatalf("execAtlasFileObject: %v", err)
	}
	out := decodeFileObjectOutput(t, ctx.Payload)
	if got := out.Downloads[0]; !strings.Contains(got.Note, "Already on the board since run run-0") {
		t.Errorf("Note = %q, want the dedupe sentence naming the run it first landed in", got.Note)
	}
}

func TestExecAtlasFileObject_TooLarge_NeverReachesAtlasAndSaysWhy(t *testing.T) {
	stub := stubFileObjectCreator(t, func(string, string, string) (AtlasFileObjectResult, error) {
		return AtlasFileObjectResult{ObjectID: "should-not-be-created"}, nil
	})
	payload := fileObjectInputPayload(t, []browserbridge.Download{
		{Path: "/downloads/giant.pdf", Filename: "giant.pdf", Bytes: 99999999, TooLarge: true},
	})

	ctx, err := execAtlasFileObject(Node{}, ExecContext{Payload: payload})
	if err != nil {
		t.Fatalf("execAtlasFileObject: %v", err)
	}
	if stub.calls != 0 {
		t.Errorf("atlassvc seam called %d times, want 0 -- no bytes ever crossed for this download", stub.calls)
	}
	got := decodeFileObjectOutput(t, ctx.Payload).Downloads[0]
	if got.ObjectID != "" {
		t.Errorf("ObjectID = %q, want empty -- nothing was created", got.ObjectID)
	}
	want := "Too large to keep with the run; the file is at /downloads/giant.pdf."
	if got.Note != want {
		t.Errorf("Note = %q, want %q", got.Note, want)
	}
}

func TestExecAtlasFileObject_NoDownloads_ProducesAnEmptyList(t *testing.T) {
	stub := stubFileObjectCreator(t, func(string, string, string) (AtlasFileObjectResult, error) {
		return AtlasFileObjectResult{}, nil
	})
	payload := fileObjectInputPayload(t, nil)

	ctx, err := execAtlasFileObject(Node{}, ExecContext{Payload: payload})
	if err != nil {
		t.Fatalf("execAtlasFileObject: %v", err)
	}
	if stub.calls != 0 {
		t.Errorf("atlassvc seam called %d times, want 0", stub.calls)
	}
	out := decodeFileObjectOutput(t, ctx.Payload)
	if out.Downloads == nil || len(out.Downloads) != 0 {
		t.Errorf("Downloads = %#v, want a non-nil empty list", out.Downloads)
	}
}

func TestExecAtlasFileObject_UnreadablePayload_Errors(t *testing.T) {
	if _, err := execAtlasFileObject(Node{}, ExecContext{Payload: "not json"}); err == nil {
		t.Error("execAtlasFileObject(bad json) = nil error, want a failure naming the payload")
	}
}

// The journal/guardrail class the design contract locks: a workflow-
// facing write to Atlas's own store, matching apply-atlas-card-create,
// never the ClassExternal the browser-driving step above it carries.
func TestApplyAtlasFileObject_NodeType_ClassLocalApplyOverJSON(t *testing.T) {
	var nt *NodeType
	for _, n := range NodeTypes() {
		if n.ID == "apply-atlas-file-object" {
			cp := n
			nt = &cp
		}
	}
	if nt == nil {
		t.Fatal(`no registered node type "apply-atlas-file-object"`)
	}
	if nt.Kind != KindApply {
		t.Errorf("Kind = %q, want %q", nt.Kind, KindApply)
	}
	if nt.Effect != guardrail.ClassLocal {
		t.Errorf("Effect = %q, want %q", nt.Effect, guardrail.ClassLocal)
	}
	if len(nt.Consumes) != 1 || nt.Consumes[0] != PayloadJSON {
		t.Errorf("Consumes = %v, want [PayloadJSON]", nt.Consumes)
	}
	if !nt.Produces.Passthrough {
		t.Error("Produces.Passthrough = false, want true")
	}
}
