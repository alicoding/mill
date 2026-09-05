package browserbridge_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// recorderExport is a flow exported by Chrome DevTools Recorder,
// trimmed to one of each shape it emits. Parsing it unchanged is the
// whole point of adopting that schema rather than defining another --
// a change here that needs the JSON edited is a change that broke it.
const recorderExport = `{
  "title": "Search the docs",
  "steps": [
    { "type": "setViewport", "width": 1280, "height": 800 },
    { "type": "navigate", "url": "https://example.com/",
      "assertedEvents": [{ "type": "navigation", "url": "https://example.com/", "title": "Example" }] },
    { "type": "click", "target": "main",
      "selectors": [["#search"], ["aria/Search"], ["text/Search"], ["xpath///*[@id=\"search\"]"], ["pierce/#search"]],
      "offsetX": 12, "offsetY": 4 },
    { "type": "change", "value": "guardrails", "selectors": [["#search"]] },
    { "type": "keyDown", "key": "Enter", "selectors": [["#search"]] },
    { "type": "waitForElement", "selectors": [[".result"]], "timeout": 8000 }
  ]
}`

func TestParseFlow_ReadsARecorderExportUnchanged(t *testing.T) {
	flow, err := browserbridge.ParseFlow([]byte(recorderExport))
	if err != nil {
		t.Fatalf("ParseFlow(recorder export) = %v, want nil error", err)
	}
	if flow.Title != "Search the docs" {
		t.Fatalf("title = %q, want the recorded title", flow.Title)
	}
	if len(flow.Steps) != 6 {
		t.Fatalf("steps = %d, want 6", len(flow.Steps))
	}
	click := flow.Steps[2]
	if len(click.Selectors) != 5 {
		t.Fatalf("click selector chains = %d, want all five the export carried", len(click.Selectors))
	}
	if click.FirstSelector() != "#search" {
		t.Fatalf("FirstSelector() = %q, want the first chain's first selector", click.FirstSelector())
	}
	if got := flow.Steps[5].Timeout(); got != 8000 {
		t.Fatalf("Timeout() = %d, want the step's own 8000", got)
	}
	if got := flow.Steps[3].Timeout(); got != browserbridge.DefaultStepTimeoutMS {
		t.Fatalf("Timeout() with none declared = %d, want %d", got, browserbridge.DefaultStepTimeoutMS)
	}
	if len(flow.Steps[1].AssertedEvents) != 1 {
		t.Fatalf("navigate step lost its asserted navigation event")
	}
}

func TestValidate_RefusesWhatARunnerCannotExecute(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"no steps", `{"title":"x","steps":[]}`, "at least one step"},
		{"unknown type", `{"steps":[{"type":"teleport"}]}`, "unknown type"},
		{"navigate with no url", `{"steps":[{"type":"navigate"}]}`, "navigates with no url"},
		{"click with no selectors", `{"steps":[{"type":"click"}]}`, "no selector chain"},
		{"click with only an empty chain", `{"steps":[{"type":"click","selectors":[[]]}]}`, "no selector chain"},
		{"expression wait with no expression", `{"steps":[{"type":"waitForExpression"}]}`, "empty expression"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := browserbridge.ParseFlow([]byte(tc.raw))
			if err == nil {
				t.Fatalf("ParseFlow(%s) = nil error, want a refusal", tc.raw)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %q, want it to name %q", err, tc.want)
			}
		})
	}
}

func TestTestFlow_MatchesThePageItRunsAgainst(t *testing.T) {
	flow := browserbridge.TestFlow("http://127.0.0.1:8092/__mill/bridge/test-page")
	if err := flow.Validate(); err != nil {
		t.Fatalf("the built-in flow does not validate: %v", err)
	}
	if len(flow.Steps) != browserbridge.TestFlowSteps {
		t.Fatalf("steps = %d, want the %d the result sentence reports", len(flow.Steps), browserbridge.TestFlowSteps)
	}
	if flow.Steps[0].Type != browserbridge.StepNavigate || flow.Steps[0].URL == "" {
		t.Fatalf("step 0 = %+v, want a navigate carrying the page url", flow.Steps[0])
	}
	if flow.Steps[1].Type != browserbridge.StepClick || flow.Steps[1].FirstSelector() != "#"+browserbridge.TestPageButtonID {
		t.Fatalf("step 1 = %+v, want a click on the test page's button", flow.Steps[1])
	}
	if flow.Steps[2].Type != browserbridge.StepWaitForElement || flow.Steps[2].FirstSelector() != "#"+browserbridge.TestPageReadyID {
		t.Fatalf("step 2 = %+v, want a wait on what the click reveals", flow.Steps[2])
	}
	if len(flow.Steps[1].Selectors) < 3 {
		t.Fatalf("the click step carries %d chains, want the fallback path exercised too", len(flow.Steps[1].Selectors))
	}
}

func TestResult_FinalSeparatesAStepFromTheRun(t *testing.T) {
	idx := 2
	step := browserbridge.Result{ID: "run-1", StepIndex: &idx, Status: browserbridge.StatusOK}
	if step.Final() {
		t.Fatalf("a result carrying a step index reports one step, not the run")
	}
	final := browserbridge.Result{ID: "run-1", Status: browserbridge.StatusDone}
	if !final.Final() {
		t.Fatalf("a result with no step index closes the run")
	}
	encoded, err := json.Marshal(step)
	if err != nil {
		t.Fatalf("marshalling a step result = %v, want nil error", err)
	}
	if !strings.Contains(string(encoded), `"stepIndex":2`) {
		t.Fatalf("encoded step result = %s, want the index on the wire", encoded)
	}
}

func TestErrors_CarryCodesAndOneSentence(t *testing.T) {
	for _, err := range []error{browserbridge.ErrNoBrowser(), browserbridge.ErrReplayTimedOut(), browserbridge.ErrReplayFailed("The tab closed.")} {
		declared, ok := usererror.Of(err)
		if !ok {
			t.Fatalf("%v is not a declared user error", err)
		}
		if !usererror.ValidMessage(declared.Message) {
			t.Fatalf("message %q is not one user-facing sentence", declared.Message)
		}
	}
	// A runner that hands back something that is not a sentence must not
	// be able to put it in front of a reader.
	generic := browserbridge.ErrReplayFailed("element: not found")
	declared, _ := usererror.Of(generic)
	if declared.Message != "The browser couldn't finish the steps." {
		t.Fatalf("a chain-shaped reason reached the UI as %q", declared.Message)
	}
}
