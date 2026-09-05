package bridgesvc

import (
	"github.com/alicoding/mill/internal/domain/browserbridge"
)

// The step inspector reads a recording through this door rather than
// parsing the export itself: one parser decides what a valid recording
// is and which of a step's fields a parameter may replace, so the
// picker an author binds through can never offer something the run
// would then refuse.

// RecordingStep is one step as the inspector lists it: its position,
// what it does, the selector that identifies it, and the fields a
// parameter may replace on it.
type RecordingStep struct {
	Index    int      `json:"index"`
	Type     string   `json:"type"`
	Selector string   `json:"selector"`
	Bindable []string `json:"bindable"`
}

// RecordingSummary is what the step shows about the recording it
// carries, and what its parameter and extraction pickers list.
type RecordingSummary struct {
	Title    string          `json:"title"`
	StartURL string          `json:"startUrl"`
	Steps    []RecordingStep `json:"steps"`
}

// ReadRecording validates an exported recording and describes it. A
// document the runner could not replay is refused here, at import,
// rather than at the first run.
func (s *BridgeService) ReadRecording(raw string) (RecordingSummary, error) {
	flow, err := browserbridge.ParseFlow([]byte(raw))
	if err != nil {
		return RecordingSummary{}, browserbridge.ErrBadRecording(err)
	}
	summary := RecordingSummary{Title: flow.Title, Steps: make([]RecordingStep, 0, len(flow.Steps))}
	for i, step := range flow.Steps {
		if summary.StartURL == "" && step.Type == browserbridge.StepNavigate {
			summary.StartURL = step.URL
		}
		summary.Steps = append(summary.Steps, RecordingStep{
			Index: i, Type: string(step.Type), Selector: step.FirstSelector(), Bindable: bindableNames(step.Type),
		})
	}
	return summary, nil
}

// bindableNames restates the bindable fields as the plain strings the
// inspector's picker stores in a parameter row.
func bindableNames(t browserbridge.StepType) []string {
	fields := browserbridge.BindableFields(t)
	names := make([]string, 0, len(fields))
	for _, f := range fields {
		names = append(names, string(f))
	}
	return names
}
