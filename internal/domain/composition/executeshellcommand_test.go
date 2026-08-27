package composition

import (
	"strings"
	"testing"
)

func runShellCommand(t *testing.T, payload string) (ExecContext, error) {
	t.Helper()
	entry, ok := nodeTypeRegistry["process-shell-command"]
	if !ok {
		t.Fatal(`node type "process-shell-command" is not registered`)
	}
	return entry.exec(Node{ID: "n1"}, ExecContext{Payload: payload, Attributes: map[string]any{}})
}

// TestProcessShellCommandExec_MultiStepPayload_RunsEachStepAndJoinsOutput
// is this node's seeded proof (seedproof_test.go's CodingLoopWorkflowID
// entry): a real multi-step payload -- newline AND && joined -- runs
// through the real procexec path (not a fake), each sub-command's own
// output lands in the combined Payload.
func TestProcessShellCommandExec_MultiStepPayload_RunsEachStepAndJoinsOutput(t *testing.T) {
	out, err := runShellCommand(t, "echo one\necho two && echo three")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	for _, want := range []string{"one", "two", "three"} {
		if !strings.Contains(out.Payload, want) {
			t.Errorf("Payload = %q, missing %q", out.Payload, want)
		}
	}
}

func TestProcessShellCommandExec_PipelineStaysOneProcess(t *testing.T) {
	out, err := runShellCommand(t, "echo hello | tr a-z A-Z")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if !strings.Contains(out.Payload, "HELLO") {
		t.Errorf("Payload = %q, want it to contain the piped-through HELLO", out.Payload)
	}
}

// TestProcessShellCommandExec_AndStep_SkippedAfterFailure pins the &&
// short-circuit property: a step joined by && never runs once the step
// before it failed.
func TestProcessShellCommandExec_AndStep_SkippedAfterFailure(t *testing.T) {
	out, err := runShellCommand(t, "false && echo MARKER-should-not-print")
	if err == nil {
		t.Fatal("exec: want an error, got nil (the false step should have failed the node)")
	}
	// The transcript legitimately echoes the SKIPPED command's own text
	// (so the user can see what was skipped) -- the property under test
	// is that the command never actually RAN, i.e. its own echoed
	// stdout line never appears on its own.
	for _, line := range strings.Split(out.Payload, "\n") {
		if strings.TrimSpace(line) == "MARKER-should-not-print" {
			t.Errorf("Payload = %q, the && step's echo actually ran despite the prior failure", out.Payload)
		}
	}
	if !strings.Contains(out.Payload, "skipped") {
		t.Errorf("Payload = %q, want it to record the skipped step", out.Payload)
	}
}

// TestProcessShellCommandExec_NewlineStep_StillRunsAfterFailure is the
// mirror property: a NEWLINE-joined step runs regardless of a prior
// step's outcome (matches pasting multiple lines into a real terminal),
// unlike the && case above.
func TestProcessShellCommandExec_NewlineStep_StillRunsAfterFailure(t *testing.T) {
	out, err := runShellCommand(t, "false\necho still-ran")
	if err == nil {
		t.Fatal("exec: want an error (the false step failed the node overall), got nil")
	}
	if !strings.Contains(out.Payload, "still-ran") {
		t.Errorf("Payload = %q, the newline-joined step should have run despite the prior failure", out.Payload)
	}
}

func TestProcessShellCommandExec_EmptyPayload_Fails(t *testing.T) {
	if _, err := runShellCommand(t, "   "); err == nil {
		t.Fatal("exec: want an error for an empty command, got nil")
	}
}

func TestResolveShellCommandTarget_FallsBackWhenShellUnset(t *testing.T) {
	t.Setenv("SHELL", "")
	target := ResolveShellCommandTarget()
	if target.Shell != DefaultLoginShellFallback {
		t.Errorf("Shell = %q, want the fallback %q", target.Shell, DefaultLoginShellFallback)
	}
	if target.Dir == "" {
		t.Error("Dir is empty -- ResolveShellCommandTarget must never return a blank cwd")
	}
}

func TestTailLines_CapsToLastNLines(t *testing.T) {
	got := tailLines("a\nb\nc\nd\ne", 3)
	if want := "c\nd\ne"; got != want {
		t.Errorf("tailLines = %q, want %q", got, want)
	}
}

func TestTailLines_ShorterThanCapIsUnchanged(t *testing.T) {
	got := tailLines("a\nb", 5)
	if want := "a\nb"; got != want {
		t.Errorf("tailLines = %q, want %q", got, want)
	}
}
