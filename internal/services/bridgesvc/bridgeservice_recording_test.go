package bridgesvc_test

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/bridgesvc"
)

// The inspector's picker is built from this summary, so what it offers
// to bind must be exactly what the overlay would accept.
func TestReadRecording_DescribesEveryStepAndWhatItCanBind(t *testing.T) {
	svc := bridgesvc.New(&stubAuth{token: "good"}, slog.New(slog.DiscardHandler))
	raw := `{"title":"Sign in","steps":[
	  {"type":"navigate","url":"https://example.test/login"},
	  {"type":"change","value":"me","selectors":[["#email"],["aria/Email"]]},
	  {"type":"keyDown","key":"Enter","selectors":[["#email"]]},
	  {"type":"waitForElement","selectors":[["#welcome"]]}
	]}`

	summary, err := svc.ReadRecording(raw)
	if err != nil {
		t.Fatalf("ReadRecording: %v", err)
	}
	if summary.Title != "Sign in" || summary.StartURL != "https://example.test/login" {
		t.Errorf("summary = %q / %q, want the recorded title and first address", summary.Title, summary.StartURL)
	}
	want := []struct {
		typ      string
		selector string
		bindable []string
	}{
		{"navigate", "", []string{"url"}},
		{"change", "#email", []string{"value"}},
		{"keyDown", "#email", []string{"key"}},
		{"waitForElement", "#welcome", []string{}},
	}
	if len(summary.Steps) != len(want) {
		t.Fatalf("summary has %d steps, want %d", len(summary.Steps), len(want))
	}
	for i, w := range want {
		got := summary.Steps[i]
		if got.Index != i || got.Type != w.typ || got.Selector != w.selector {
			t.Errorf("step %d = %+v, want index %d type %q selector %q", i, got, i, w.typ, w.selector)
		}
		if len(got.Bindable) != len(w.bindable) {
			t.Errorf("step %d bindable = %v, want %v", i, got.Bindable, w.bindable)
			continue
		}
		for j, name := range w.bindable {
			if got.Bindable[j] != name {
				t.Errorf("step %d bindable[%d] = %q, want %q", i, j, got.Bindable[j], name)
			}
		}
	}
}

// A document the runner could not replay is refused at import, with
// the one sentence a reader can act on.
func TestReadRecording_RefusesWhatCannotBeReplayed(t *testing.T) {
	svc := bridgesvc.New(&stubAuth{token: "good"}, slog.New(slog.DiscardHandler))
	for _, raw := range []string{"", "not json", `{"title":"x","steps":[]}`, `{"title":"x","steps":[{"type":"teleport"}]}`} {
		_, err := svc.ReadRecording(raw)
		if err == nil {
			t.Fatalf("ReadRecording(%q) returned no error", raw)
		}
		declared, ok := usererror.Of(err)
		if !ok || declared.Code != browserbridge.CodeBadRecording {
			t.Fatalf("ReadRecording(%q) error = %v, want code %q", raw, err, browserbridge.CodeBadRecording)
		}
		if declared.Message != "That recording isn't readable. Import the JSON your browser's recorder exported." {
			t.Errorf("message = %q, want the import-it sentence", declared.Message)
		}
	}
}
