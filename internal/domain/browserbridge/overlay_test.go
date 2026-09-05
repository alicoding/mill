package browserbridge_test

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// recorded is the shape every case below binds against: one navigate,
// one change, one keyDown, one waitForElement -- the three bindable
// fields plus a step that carries none of them.
func recorded() browserbridge.UserFlow {
	return browserbridge.UserFlow{
		Title: "Recorded",
		Steps: []browserbridge.Step{
			{Type: browserbridge.StepNavigate, URL: "https://recorded.example/start",
				AssertedEvents: []browserbridge.AssertedEvent{{Type: "navigation", URL: "https://recorded.example/start"}}},
			{Type: browserbridge.StepChange, Value: "recorded text", Selectors: [][]string{{"#email"}}},
			{Type: browserbridge.StepKeyDown, Key: "Enter", Selectors: [][]string{{"#email"}}},
			{Type: browserbridge.StepWaitForElement, Selectors: [][]string{{"#result"}}},
		},
	}
}

func TestOverlay_ReplacesEachBindableField(t *testing.T) {
	cases := []struct {
		name  string
		bind  browserbridge.Binding
		check func(t *testing.T, got browserbridge.UserFlow)
	}{
		{
			name: "value on a change step",
			bind: browserbridge.Binding{Name: "email", StepIndex: 1, Field: browserbridge.BindValue, Value: "bound@example.com"},
			check: func(t *testing.T, got browserbridge.UserFlow) {
				if got.Steps[1].Value != "bound@example.com" {
					t.Errorf("step 1 value = %q, want the bound value", got.Steps[1].Value)
				}
			},
		},
		{
			name: "url on a navigate step",
			bind: browserbridge.Binding{Name: "target", StepIndex: 0, Field: browserbridge.BindURL, Value: "https://bound.example/go"},
			check: func(t *testing.T, got browserbridge.UserFlow) {
				if got.Steps[0].URL != "https://bound.example/go" {
					t.Errorf("step 0 url = %q, want the bound url", got.Steps[0].URL)
				}
				// The recorded navigation assertion would otherwise wait
				// for an address the run never visits.
				if got.Steps[0].AssertedEvents[0].URL != "https://bound.example/go" {
					t.Errorf("asserted navigation url = %q, want the bound url", got.Steps[0].AssertedEvents[0].URL)
				}
			},
		},
		{
			name: "key on a keyDown step",
			bind: browserbridge.Binding{Name: "submit", StepIndex: 2, Field: browserbridge.BindKey, Value: "Tab"},
			check: func(t *testing.T, got browserbridge.UserFlow) {
				if got.Steps[2].Key != "Tab" {
					t.Errorf("step 2 key = %q, want the bound key", got.Steps[2].Key)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := browserbridge.Overlay(recorded(), []browserbridge.Binding{tc.bind})
			if err != nil {
				t.Fatalf("Overlay: %v", err)
			}
			tc.check(t, got)
		})
	}
}

// The stored recording must survive a run unchanged -- a re-export
// from the Recorder is the only thing allowed to rewrite it.
func TestOverlay_LeavesTheRecordingUntouched(t *testing.T) {
	flow := recorded()
	if _, err := browserbridge.Overlay(flow, []browserbridge.Binding{
		{Name: "email", StepIndex: 1, Field: browserbridge.BindValue, Value: "bound@example.com"},
		{Name: "target", StepIndex: 0, Field: browserbridge.BindURL, Value: "https://bound.example/go"},
	}); err != nil {
		t.Fatalf("Overlay: %v", err)
	}
	if flow.Steps[1].Value != "recorded text" {
		t.Errorf("the recording's change value became %q", flow.Steps[1].Value)
	}
	if flow.Steps[0].AssertedEvents[0].URL != "https://recorded.example/start" {
		t.Errorf("the recording's asserted navigation became %q", flow.Steps[0].AssertedEvents[0].URL)
	}
}

func TestOverlay_RefusesABindingThatPointsNowhere(t *testing.T) {
	cases := []struct {
		name string
		bind browserbridge.Binding
		want string
	}{
		{
			name: "a step the recording doesn't have",
			bind: browserbridge.Binding{Name: "email", StepIndex: 9, Field: browserbridge.BindValue},
			want: "Parameter email points at step 10, which this recording doesn't have.",
		},
		{
			name: "a negative index",
			bind: browserbridge.Binding{Name: "email", StepIndex: -1, Field: browserbridge.BindValue},
			want: "Parameter email points at step 0, which this recording doesn't have.",
		},
		{
			name: "a field this step type doesn't carry",
			bind: browserbridge.Binding{Name: "email", StepIndex: 3, Field: browserbridge.BindValue},
			want: "Parameter email points at step 4, which has no value.",
		},
		{
			name: "a url binding on a change step",
			bind: browserbridge.Binding{Name: "target", StepIndex: 1, Field: browserbridge.BindURL},
			want: "Parameter target points at step 2, which has no url.",
		},
		{
			name: "a field outside the bindable set",
			bind: browserbridge.Binding{Name: "odd", StepIndex: 1, Field: browserbridge.BindField("selectors")},
			want: "Parameter odd points at step 2, which has no selectors.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := browserbridge.Overlay(recorded(), []browserbridge.Binding{tc.bind})
			if err == nil {
				t.Fatal("Overlay accepted a binding that points nowhere")
			}
			declared, ok := usererror.Of(err)
			if !ok {
				t.Fatalf("Overlay's error is not a declared user error: %v", err)
			}
			if declared.Code != browserbridge.CodeBadParameter {
				t.Errorf("code = %q, want %q", declared.Code, browserbridge.CodeBadParameter)
			}
			if declared.Message != tc.want {
				t.Errorf("message = %q, want %q", declared.Message, tc.want)
			}
		})
	}
}

// No bindings at all is the ordinary case for a recording with no
// parameters -- it must still produce a runnable copy.
func TestOverlay_WithNoBindingsCopiesTheFlow(t *testing.T) {
	got, err := browserbridge.Overlay(recorded(), nil)
	if err != nil {
		t.Fatalf("Overlay: %v", err)
	}
	if err := got.Validate(); err != nil {
		t.Errorf("the copied flow no longer validates: %v", err)
	}
	if len(got.Steps) != 4 || !strings.EqualFold(got.Title, "Recorded") {
		t.Errorf("Overlay returned %d steps titled %q", len(got.Steps), got.Title)
	}
}

func TestValidBindField(t *testing.T) {
	for _, f := range []browserbridge.BindField{browserbridge.BindValue, browserbridge.BindURL, browserbridge.BindKey} {
		if !browserbridge.ValidBindField(f) {
			t.Errorf("ValidBindField(%q) = false, want true", f)
		}
	}
	for _, f := range []browserbridge.BindField{"", "selectors", "timeout"} {
		if browserbridge.ValidBindField(f) {
			t.Errorf("ValidBindField(%q) = true, want false", f)
		}
	}
}
