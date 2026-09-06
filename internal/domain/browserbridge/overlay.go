package browserbridge

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// A recorded flow is replayed byte-identical to the Recorder's export;
// the only way a run varies is a Binding overlaid onto a named field of
// a named step. Typed bindings rather than placeholder text inside the
// recording: a placeholder would edit the artifact, and a re-export
// from the Recorder would then silently drop every parameter.

// BindField is the one field of one step a Binding may replace. The
// set is closed -- a step's selectors, timeouts and asserted events
// describe the RECORDING and never vary per run.
type BindField string

// The bindable fields, named as the Recorder itself names them.
const (
	// BindValue replaces a change step's typed text.
	BindValue BindField = "value"
	// BindURL replaces a navigate step's address.
	BindURL BindField = "url"
	// BindKey replaces a keyDown/keyUp step's key.
	BindKey BindField = "key"
)

// ValidBindField reports whether f is one of the three bindable fields.
func ValidBindField(f BindField) bool {
	switch f {
	case BindValue, BindURL, BindKey:
		return true
	}
	return false
}

// bindableStep maps a field to the step types that carry it, so a
// binding pointing at a step that has no such field is refused before
// a browser is asked to run anything.
var bindableStep = map[BindField]map[StepType]bool{
	BindValue: {StepChange: true},
	BindURL:   {StepNavigate: true},
	BindKey:   {StepKeyDown: true, StepKeyUp: true},
}

// Binding is one already-resolved parameter: Value has been read from
// the run's Attributes or taken from a literal by the caller. This
// package never reads Attributes itself.
//
// StepIndex is 0-based, matching Result.StepIndex on the wire; every
// SENTENCE built from it counts from 1, matching how the browser
// runner already numbers steps to a reader.
type Binding struct {
	Name      string
	StepIndex int
	Field     BindField
	Value     string
}

// CodeBadParameter is the handle for a binding that cannot be applied
// to the recording it names -- an authoring mistake, fixable in the
// step's own Parameters table.
const CodeBadParameter = "browser-replay-bad-parameter"

// Overlay returns a copy of flow with every binding applied, leaving
// flow itself untouched: the stored recording stays exactly what the
// Recorder exported, and a failed run can be re-read against it.
//
// A binding naming a step the recording does not have, or a field that
// step type does not carry, fails here rather than in the browser --
// the difference between a sentence naming the parameter and a
// selector error a reader cannot trace back to it.
func Overlay(flow UserFlow, bindings []Binding) (UserFlow, error) {
	out := flow
	out.Steps = make([]Step, len(flow.Steps))
	copy(out.Steps, flow.Steps)

	for _, b := range bindings {
		if b.StepIndex < 0 || b.StepIndex >= len(out.Steps) {
			return UserFlow{}, badParameter(b, fmt.Sprintf("step %d, which this recording doesn't have", b.StepIndex+1))
		}
		step := out.Steps[b.StepIndex]
		if !ValidBindField(b.Field) || !bindableStep[b.Field][step.Type] {
			return UserFlow{}, badParameter(b, fmt.Sprintf("step %d, which has no %s", b.StepIndex+1, b.Field))
		}
		switch b.Field {
		case BindValue:
			step.Value = b.Value
		case BindURL:
			step.URL = b.Value
			// An asserted navigation still names the RECORDED address,
			// which a bound URL has just replaced -- a runner waiting
			// for the old one would wait forever.
			step.AssertedEvents = retargetNavigation(step.AssertedEvents, b.Value)
		case BindKey:
			step.Key = b.Value
		}
		out.Steps[b.StepIndex] = step
	}
	return out, nil
}

// badParameter builds the one sentence an author acts on: which
// parameter, and what it points at that isn't there.
func badParameter(b Binding, points string) error {
	return usererror.New(CodeBadParameter, fmt.Sprintf("Parameter %s points at %s.", b.Name, points))
}

// retargetNavigation rewrites a navigation assertion's URL to the one
// actually being visited, copying rather than mutating the recorded
// slice (Overlay's copy is shallow, so the backing array is shared).
func retargetNavigation(events []AssertedEvent, url string) []AssertedEvent {
	if len(events) == 0 {
		return events
	}
	out := make([]AssertedEvent, len(events))
	copy(out, events)
	for i := range out {
		if out[i].Type == "navigation" && out[i].URL != "" {
			out[i].URL = url
		}
	}
	return out
}

// bindFieldOrder fixes the order BindableFields reports, so a picker
// built from it never reshuffles between renders.
var bindFieldOrder = []BindField{BindURL, BindValue, BindKey}

// BindableFields lists the fields a step of this type can carry a
// parameter for. Empty for a step whose every field describes the
// RECORDING rather than the run.
func BindableFields(t StepType) []BindField {
	fields := make([]BindField, 0, len(bindFieldOrder))
	for _, f := range bindFieldOrder {
		if bindableStep[f][t] {
			fields = append(fields, f)
		}
	}
	return fields
}
