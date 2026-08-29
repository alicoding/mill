package codeloopsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newTestPreviewService builds a CodeLoopService with a REAL, freshly
// seeded GuardrailService (guardrail.BuiltIn's own default allow/deny
// lists included) -- PreviewCommandBlock needs no ExecutionService, so
// this stays a plain unit-level construction, unlike the secret-chain
// integration test's full wired stack.
func newTestPreviewService(t *testing.T) *CodeLoopService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	return NewCodeLoopService(guard)
}

// TestPreviewCommandBlock_PerStepVerdicts_MixedAllowAndDefaultAsk proves
// goal 0240 S3's Confirm-screen contract: a captured block with one
// allow-listed line and one unlisted line comes back with EACH step
// carrying its OWN verdict/rule label, while the top-level
// GuardrailVerdict is the block's most restrictive (the unlisted line's
// default ask) -- matching what the real execution gate will actually
// do (evaluateVerdict/WorstVerdict in executionsvc).
func TestPreviewCommandBlock_PerStepVerdicts_MixedAllowAndDefaultAsk(t *testing.T) {
	s := newTestPreviewService(t)

	preview, err := s.PreviewCommandBlock("ls\necho hello")
	if err != nil {
		t.Fatalf("PreviewCommandBlock: %v", err)
	}
	if len(preview.Steps) != 2 {
		t.Fatalf("len(Steps) = %d, want 2", len(preview.Steps))
	}
	if preview.Steps[0].Verdict != "allow" || preview.Steps[0].RuleLabel == "" {
		t.Errorf("Steps[0] (ls) = %+v, want allow with a non-empty rule label", preview.Steps[0])
	}
	if preview.Steps[1].Verdict != "ask" || preview.Steps[1].RuleLabel != "" {
		t.Errorf("Steps[1] (echo hello) = %+v, want ask with NO rule label (the class default, not a list match)", preview.Steps[1])
	}
	if preview.GuardrailVerdict != "ask" {
		t.Errorf("GuardrailVerdict = %q, want ask (the block's most restrictive step)", preview.GuardrailVerdict)
	}
}

// TestPreviewCommandBlock_PureAllowListedBlock_TopLevelVerdictIsAllow
// proves the actual usability-cliff fix: a block whose EVERY line
// matches an allow pattern reports an "allow" top-level verdict, the
// signal the Confirm screen and the real gate both use to skip the
// approval ceremony entirely.
func TestPreviewCommandBlock_PureAllowListedBlock_TopLevelVerdictIsAllow(t *testing.T) {
	s := newTestPreviewService(t)

	preview, err := s.PreviewCommandBlock("ls\nopenssl s_client -connect example.test:443")
	if err != nil {
		t.Fatalf("PreviewCommandBlock: %v", err)
	}
	if preview.GuardrailVerdict != "allow" {
		t.Errorf("GuardrailVerdict = %q, want allow (every step is allow-listed)", preview.GuardrailVerdict)
	}
	for i, step := range preview.Steps {
		if step.Verdict != "allow" {
			t.Errorf("Steps[%d] = %+v, want allow", i, step)
		}
	}
}

// TestPreviewCommandBlock_DenyListedLine_TopLevelVerdictIsAsk proves the
// deny list's own bypass-is-approve model shows up in the preview: the
// dangerous line's own verdict/rule label is distinct from an ordinary
// default ask.
func TestPreviewCommandBlock_DenyListedLine_TopLevelVerdictIsAsk(t *testing.T) {
	s := newTestPreviewService(t)

	preview, err := s.PreviewCommandBlock("rm -rf /tmp/whatever")
	if err != nil {
		t.Fatalf("PreviewCommandBlock: %v", err)
	}
	if preview.GuardrailVerdict != "ask" {
		t.Errorf("GuardrailVerdict = %q, want ask", preview.GuardrailVerdict)
	}
	if preview.Steps[0].Verdict != "ask" || preview.Steps[0].RuleLabel == "" {
		t.Errorf("Steps[0] = %+v, want ask with a non-empty rule label naming the deny-list rule", preview.Steps[0])
	}
}

// The Confirm screen names the configured execution environment
// (docs/goals/0240 S4): a wired preview lookup overrides shell/dir and
// sets the label; unwired (or no environment set) keeps the default
// real-login-shell target untouched.
func TestPreviewCommandBlock_EnvironmentLabel(t *testing.T) {
	s := newTestPreviewService(t)
	preview, err := s.PreviewCommandBlock("echo hi")
	if err != nil {
		t.Fatalf("PreviewCommandBlock: %v", err)
	}
	if preview.EnvironmentLabel != "" {
		t.Fatalf("unwired EnvironmentLabel = %q, want empty", preview.EnvironmentLabel)
	}

	s.SetShellEnvPreview(func() (string, string, string, bool) { return "Safe sandbox", "/bin/sh", "/tmp/box", true })
	preview, err = s.PreviewCommandBlock("echo hi")
	if err != nil {
		t.Fatalf("PreviewCommandBlock (env): %v", err)
	}
	if preview.EnvironmentLabel != "Safe sandbox" || preview.Shell != "/bin/sh" || preview.Dir != "/tmp/box" {
		t.Fatalf("preview = %+v, want the environment's label/shell/dir", preview)
	}
}
