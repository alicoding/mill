package composition

import (
	"os"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/procexec"
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

func TestAdminForcedAsk_ReadsNodeConfig(t *testing.T) {
	if AdminForcedAsk(Node{NodeTypeID: "process-shell-command", Config: map[string]string{"runWithAdmin": "true"}}) != true {
		t.Fatal("admin shell node must force ask")
	}
	if AdminForcedAsk(Node{NodeTypeID: "process-shell-command"}) {
		t.Fatal("default shell node must not force ask")
	}
	if AdminForcedAsk(Node{NodeTypeID: "code-execution", Config: map[string]string{"runWithAdmin": "true"}}) {
		t.Fatal("only the shell step carries the admin mode")
	}
}

// TestWrapArgvForAdmin_SudoAskpassShape pins the escalation mechanism
// (goal 0240 S5): sudo's own -A/SUDO_ASKPASS hook, an executable
// askpass helper materialized 0700, and NEVER the deprecated
// administrator-privileges AppleScript API.
func TestWrapArgvForAdmin_SudoAskpassShape(t *testing.T) {
	argv, env, err := wrapArgvForAdmin([]string{"/bin/zsh", "-c", "whoami"})
	if err != nil {
		t.Fatalf("wrapArgvForAdmin: %v", err)
	}
	if argv[0] != "/usr/bin/sudo" || argv[1] != "-A" || argv[2] != "/bin/zsh" {
		t.Fatalf("argv = %v, want the original argv behind sudo -A", argv)
	}
	var askpass string
	for _, kv := range env {
		if strings.HasPrefix(kv, "SUDO_ASKPASS=") {
			askpass = strings.TrimPrefix(kv, "SUDO_ASKPASS=")
		}
	}
	if askpass == "" {
		t.Fatal("env carries no SUDO_ASKPASS")
	}
	info, err := os.Stat(askpass)
	if err != nil {
		t.Fatalf("askpass helper missing: %v", err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("askpass mode = %v, want 0700", info.Mode().Perm())
	}
	content, err := os.ReadFile(askpass) //nolint:gosec // the path under test comes from this test's own env assertion, not user input
	if err != nil {
		t.Fatalf("read askpass: %v", err)
	}
	if !strings.Contains(string(content), "hidden answer") || strings.Contains(string(content), "administrator privileges") {
		t.Fatalf("askpass content = %q, want a hidden-answer dialog and never the admin-privileges API", content)
	}
}

// TestProcessShellCommand_AdminRun_WrapsEveryStep proves the exec path
// consults the node's own runWithAdmin config: each step's Spec argv is
// wrapped and its env carries SUDO_ASKPASS, without any real sudo
// spawn (runner stubbed).
func TestProcessShellCommand_AdminRun_WrapsEveryStep(t *testing.T) {
	var specs []procexec.Spec
	orig := startShellProcessFn
	SetShellCommandRunner(func(s procexec.Spec) (*procexec.Handle, error) {
		specs = append(specs, s)
		return procexec.Start(procexec.Spec{Argv: []string{"true"}, Output: s.Output})
	})
	t.Cleanup(func() { startShellProcessFn = orig })

	entry := nodeTypeRegistry["process-shell-command"]
	node := Node{ID: "n1", NodeTypeID: "process-shell-command", Config: map[string]string{"runWithAdmin": "true"}}
	if _, err := entry.exec(node, ExecContext{Payload: "echo a\necho b", Attributes: map[string]any{}}); err != nil {
		t.Fatalf("exec: %v", err)
	}
	if len(specs) != 2 {
		t.Fatalf("got %d specs, want 2", len(specs))
	}
	for i, s := range specs {
		if s.Argv[0] != "/usr/bin/sudo" || s.Argv[1] != "-A" {
			t.Fatalf("step %d argv = %v, want sudo -A wrapping", i, s.Argv)
		}
		found := false
		for _, kv := range s.Env {
			if strings.HasPrefix(kv, "SUDO_ASKPASS=") {
				found = true
			}
		}
		if !found {
			t.Fatalf("step %d env carries no SUDO_ASKPASS", i)
		}
	}
}

// TestProcessShellCommand_AdminWithSecrets_RefusedHonestly pins the
// recorded seam: sudo's env_reset would strip a resolved secret from
// the escalated child, so the combination fails with a clear message
// instead of silently running without the secret.
func TestProcessShellCommand_AdminWithSecrets_RefusedHonestly(t *testing.T) {
	entry := nodeTypeRegistry["process-shell-command"]
	node := Node{ID: "n1", NodeTypeID: "process-shell-command", Config: map[string]string{"runWithAdmin": "true"}}
	// $MILL_S5_TOKEN matches the secret-shaped env-ref pattern, so the
	// block resolves a secret env and the admin combination must refuse.
	_, err := entry.exec(node, ExecContext{Payload: "echo $MILL_S5_TOKEN", Attributes: map[string]any{}})
	if err == nil || !strings.Contains(err.Error(), "can't run with admin rights") {
		t.Fatalf("err = %v, want the honest secrets-with-admin refusal", err)
	}
}
