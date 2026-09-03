package executionsvc

import (
	"strings"
	"testing"
)

// A pure step runs alone on the given input through its registered exec.
func TestTestStep_RunsAPureStepOnTheInput(t *testing.T) {
	exec, _ := newTestExecutionService(t)
	res, err := exec.TestStep(StepTestRequest{NodeTypeID: "process-transform-text", Config: map[string]string{"operation": "sha256"}, Payload: "abc"})
	if err != nil {
		t.Fatalf("TestStep: %v", err)
	}
	if res.Refused || res.Error != "" {
		t.Fatalf("result = %+v, want a clean run", res)
	}
	if res.Output != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("output = %q, want sha256(abc)", res.Output)
	}
}

// A step whose guardrail verdict would ask is REFUSED with the verdict,
// never run: an unlisted shell command asks by default.
func TestTestStep_RefusesWhatTheGuardrailWouldAsk(t *testing.T) {
	exec, _ := newTestExecutionService(t)
	res, err := exec.TestStep(StepTestRequest{NodeTypeID: "process-shell-command", Payload: "$ rm -rf /tmp/never"})
	if err != nil {
		t.Fatalf("TestStep: %v", err)
	}
	if !res.Refused || res.RefusedEffect != "ask" {
		t.Fatalf("result = %+v, want a refusal carrying the ask verdict", res)
	}
	if res.Output != "" {
		t.Fatal("a refused step produced output")
	}
}

// A step that fails reports its own error as a result, and a step with
// nothing to run alone (a trigger) is named as such.
func TestTestStep_StepFailureAndTriggerAreResults(t *testing.T) {
	exec, _ := newTestExecutionService(t)
	res, err := exec.TestStep(StepTestRequest{NodeTypeID: "trigger-manual", Payload: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Error, "nothing to run on its own") {
		t.Fatalf("trigger result = %+v", res)
	}
	res, err = exec.TestStep(StepTestRequest{NodeTypeID: "no-such-step"})
	if err != nil || !strings.Contains(res.Error, "unknown step type") {
		t.Fatalf("unknown = %+v err=%v", res, err)
	}
}
