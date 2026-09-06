package composition

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// stubReplayer swaps the browser seam for the duration of one test,
// recording what the step actually asked the browser to run.
func stubReplayer(t *testing.T, outcome BrowserReplayOutcome, err error) *struct {
	flow    browserbridge.UserFlow
	timeout time.Duration
	calls   int
} {
	t.Helper()
	seen := &struct {
		flow    browserbridge.UserFlow
		timeout time.Duration
		calls   int
	}{}
	SetBrowserReplayer(func(flow browserbridge.UserFlow, timeout time.Duration) (BrowserReplayOutcome, error) {
		seen.flow, seen.timeout, seen.calls = flow, timeout, seen.calls+1
		return outcome, err
	})
	t.Cleanup(func() {
		SetBrowserReplayer(func(_ browserbridge.UserFlow, _ time.Duration) (BrowserReplayOutcome, error) {
			return BrowserReplayOutcome{}, browserbridge.ErrNoBrowser()
		})
	})
	return seen
}

// replayNode builds a browser-replay node carrying the seeded example's
// own recording, with whatever config overrides a case needs.
func replayNode(t *testing.T, overrides map[string]string) Node {
	t.Helper()
	config := map[string]string{
		"recording":      mustEncode(exampleBrowserReplayFlow()),
		"parameters":     "",
		"extract":        "",
		"timeoutSeconds": "60",
		"browser":        browserMostRecent,
	}
	for k, v := range overrides {
		config[k] = v
	}
	nodes, err := ResolveNodeDefaults([]Node{{ID: "n1", NodeTypeID: "process-browser-replay", Config: config}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	return nodes[0]
}

func decodeOutput(t *testing.T, payload string) browserReplayOutput {
	t.Helper()
	var out browserReplayOutput
	if err := json.Unmarshal([]byte(payload), &out); err != nil {
		t.Fatalf("the step's payload is not readable JSON: %v (%q)", err, payload)
	}
	return out
}

// The whole task in one case: a run's Attributes reach the recorded
// steps they are bound to, the browser runs the BOUND copy, and the
// named extraction comes back out of the step it points at.
func TestExecBrowserReplay_OverlaysParametersAndExtractsByStep(t *testing.T) {
	seen := stubReplayer(t, BrowserReplayOutcome{
		Steps: []BrowserReplayStep{
			{Index: 0, Status: browserbridge.StatusOK},
			{Index: 1, Status: browserbridge.StatusOK, Extracted: "typed by the run"},
			{Index: 2, Status: browserbridge.StatusOK},
			{Index: 3, Status: browserbridge.StatusOK, Extracted: "typed by the run"},
		},
		Downloads: []browserbridge.Download{{Path: "/tmp/report.csv", Filename: "report.csv", Bytes: 12}},
	}, nil)

	node := replayNode(t, map[string]string{
		"parameters": mustEncode([]browserReplayParameter{
			{Name: "pageUrl", StepIndex: 0, Field: "url", Source: browserReplayAttrSource + "pageUrl"},
			{Name: "text", StepIndex: 1, Field: "value", Source: browserReplayAttrSource + "text"},
		}),
		"extract":        mustEncode([]browserReplayExtraction{{Name: "echoed", StepIndex: 3}}),
		"timeoutSeconds": "15",
	})
	out, err := execBrowserReplay(node, ExecContext{Attributes: map[string]any{
		"pageUrl": "http://127.0.0.1:9999/page", "text": "typed by the run",
	}})
	if err != nil {
		t.Fatalf("execBrowserReplay: %v", err)
	}

	if seen.flow.Steps[0].URL != "http://127.0.0.1:9999/page" {
		t.Errorf("the browser was sent url %q, want the bound one", seen.flow.Steps[0].URL)
	}
	if seen.flow.Steps[1].Value != "typed by the run" {
		t.Errorf("the browser was sent value %q, want the bound one", seen.flow.Steps[1].Value)
	}
	if seen.timeout != 15*time.Second {
		t.Errorf("timeout = %v, want the configured 15s", seen.timeout)
	}

	decoded := decodeOutput(t, out.Payload)
	if decoded.Extracted["echoed"] != "typed by the run" {
		t.Errorf("extracted[echoed] = %q, want the text step 3 read back", decoded.Extracted["echoed"])
	}
	if len(decoded.Steps) != 4 || decoded.Steps[3].Index != 3 || decoded.Steps[3].Status != browserbridge.StatusOK {
		t.Errorf("steps = %+v, want four ok rows in order", decoded.Steps)
	}
	if len(decoded.Downloads) != 1 || decoded.Downloads[0].Filename != "report.csv" {
		t.Errorf("downloads = %+v, want the browser's own saved file", decoded.Downloads)
	}
}

// A literal parameter needs no Attribute at all, and an unset one
// resolves to empty rather than failing the run.
func TestExecBrowserReplay_LiteralAndMissingAttributeSources(t *testing.T) {
	seen := stubReplayer(t, BrowserReplayOutcome{Steps: []BrowserReplayStep{{Index: 0, Status: browserbridge.StatusOK}}}, nil)
	node := replayNode(t, map[string]string{
		"parameters": mustEncode([]browserReplayParameter{
			{Name: "text", StepIndex: 1, Field: "value", Source: browserReplaySourceLiteral, Literal: "a fixed value"},
			{Name: "key", StepIndex: 1, Field: "value", Source: browserReplayAttrSource + "nothing"},
		}),
	})
	if _, err := execBrowserReplay(node, ExecContext{Attributes: map[string]any{}}); err != nil {
		t.Fatalf("execBrowserReplay: %v", err)
	}
	// The second binding wins on the same field, and resolves to "".
	if seen.flow.Steps[1].Value != "" {
		t.Errorf("step 1 value = %q, want the unset attribute's empty value", seen.flow.Steps[1].Value)
	}
}

// Every failure a reader can act on, and the exact sentence each one
// arrives as.
func TestExecBrowserReplay_FailureSentences(t *testing.T) {
	failedRun := BrowserReplayOutcome{Steps: []BrowserReplayStep{
		{Index: 0, Status: browserbridge.StatusOK},
		{Index: 1, Status: browserbridge.StatusFailed, Error: "Step 2 couldn't run in this page."},
	}}
	cases := []struct {
		name     string
		node     map[string]string
		outcome  BrowserReplayOutcome
		fromFn   error
		wantCode string
		wantMsg  string
	}{
		{
			name:     "no browser connected",
			fromFn:   browserbridge.ErrNoBrowser(),
			wantCode: browserbridge.CodeNoBrowser,
			wantMsg:  "No browser is connected. Pair the Mill extension first.",
		},
		{
			name:     "a step's element was never found",
			outcome:  failedRun,
			fromFn:   browserbridge.ErrReplayFailed("Step 2 couldn't run in this page."),
			wantCode: browserbridge.CodeSelectorMiss,
			wantMsg:  "Couldn't find the element for step 2 (#" + browserbridge.TestPageInputID + ").",
		},
		{
			name:     "the flow never finished",
			fromFn:   browserbridge.ErrReplayTimedOutAfter(60 * time.Second),
			wantCode: browserbridge.CodeReplayTimedOut,
			wantMsg:  "The browser didn't finish the flow in 60 seconds.",
		},
		{
			name:     "a parameter points at a field the step doesn't have",
			node:     map[string]string{"parameters": mustEncode([]browserReplayParameter{{Name: "text", StepIndex: 2, Field: "value", Source: browserReplaySourceLiteral}})},
			wantCode: browserbridge.CodeBadParameter,
			wantMsg:  "Parameter text points at step 3, which has no value.",
		},
		{
			name:     "a parameter points past the end of the recording",
			node:     map[string]string{"parameters": mustEncode([]browserReplayParameter{{Name: "text", StepIndex: 7, Field: "value", Source: browserReplaySourceLiteral}})},
			wantCode: browserbridge.CodeBadParameter,
			wantMsg:  "Parameter text points at step 8, which this recording doesn't have.",
		},
		{
			name:     "an unnamed parameter",
			node:     map[string]string{"parameters": mustEncode([]browserReplayParameter{{StepIndex: 1, Field: "value"}})},
			wantCode: CodeBadStepConfig,
			wantMsg:  "Every parameter needs a name.",
		},
		{
			name:     "an unnamed extraction",
			node:     map[string]string{"extract": mustEncode([]browserReplayExtraction{{StepIndex: 3}})},
			wantCode: CodeBadStepConfig,
			wantMsg:  "Every extracted value needs a name.",
		},
		{
			name:     "an unreadable parameters table",
			node:     map[string]string{"parameters": "{not a list}"},
			wantCode: CodeBadStepConfig,
			wantMsg:  "The Parameters list isn't readable. Edit it in the step's own table.",
		},
		{
			name:     "an unreadable extract table",
			node:     map[string]string{"extract": "{not a list}"},
			wantCode: CodeBadStepConfig,
			wantMsg:  "The Extract list isn't readable. Edit it in the step's own table.",
		},
		{
			name:     "no recording at all",
			node:     map[string]string{"recording": ""},
			wantCode: browserbridge.CodeBadRecording,
			wantMsg:  "That recording isn't readable. Import the JSON your browser's recorder exported.",
		},
		{
			name:     "a recording that isn't the recorder's export",
			node:     map[string]string{"recording": `{"title":"x","steps":[{"type":"teleport"}]}`},
			wantCode: browserbridge.CodeBadRecording,
			wantMsg:  "That recording isn't readable. Import the JSON your browser's recorder exported.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stubReplayer(t, tc.outcome, tc.fromFn)
			_, err := execBrowserReplay(replayNode(t, tc.node), ExecContext{Attributes: map[string]any{}})
			if err == nil {
				t.Fatal("the step succeeded, want a failure")
			}
			declared, ok := usererror.Of(err)
			if !ok {
				t.Fatalf("the failure is not a declared user error: %v", err)
			}
			if declared.Code != tc.wantCode || declared.Message != tc.wantMsg {
				t.Errorf("failure = %q/%q, want %q/%q", declared.Code, declared.Message, tc.wantCode, tc.wantMsg)
			}
		})
	}
}

// An unset or nonsense timeout still bounds the run.
func TestBrowserReplayTimeout_FallsBackToTheDefault(t *testing.T) {
	for _, raw := range []string{"", "0", "-5", "soon"} {
		if got := browserReplayTimeout(raw); got != browserReplayDefaultTimeout*time.Second {
			t.Errorf("browserReplayTimeout(%q) = %v, want the default", raw, got)
		}
	}
	if got := browserReplayTimeout(" 30 "); got != 30*time.Second {
		t.Errorf("browserReplayTimeout(\" 30 \") = %v, want 30s", got)
	}
}

// The seeded example must carry a recording the parser accepts and
// parameters that point at real steps -- otherwise its first run fails
// on config, not on a missing browser.
func TestSeededBrowserReplayExample_IsRunnableAsShipped(t *testing.T) {
	var step Node
	for _, wf := range builtInBrowserReplayWorkflows() {
		for _, n := range wf.Nodes {
			if n.NodeTypeID == "process-browser-replay" {
				step = n
			}
		}
	}
	if step.ID == "" {
		t.Fatal("the seeded example has no browser-replay step")
	}
	flow, err := browserbridge.ParseFlow([]byte(step.Config["recording"]))
	if err != nil {
		t.Fatalf("the seeded recording does not parse: %v", err)
	}
	bindings, err := browserReplayBindings(step.Config["parameters"], map[string]any{"pageUrl": "http://x/y", "text": "t"})
	if err != nil {
		t.Fatalf("the seeded parameters do not resolve: %v", err)
	}
	if _, err := browserbridge.Overlay(flow, bindings); err != nil {
		t.Fatalf("the seeded parameters do not apply to the seeded recording: %v", err)
	}
	if !strings.Contains(step.Config["extract"], ExampleBrowserReplayOutput) {
		t.Errorf("the seeded example extracts %q, want %q", step.Config["extract"], ExampleBrowserReplayOutput)
	}
}
