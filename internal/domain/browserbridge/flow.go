// Package browserbridge is the browser bridge's protocol core: the
// DevTools Recorder flow schema Mill sends to a paired browser, the
// command/result envelopes that carry it, and the built-in flow the
// connection test replays. Pure domain -- no HTTP, no persistence, no
// browser access; bridgesvc owns those.
//
// The step and selector vocabulary is Chrome DevTools Recorder's own
// (@puppeteer/replay's UserFlow), adopted whole rather than
// re-invented: a flow recorded in DevTools and exported as JSON is
// valid input here with no translation step.
package browserbridge

import (
	"encoding/json"
	"fmt"
	"strings"
)

// StepType is one entry in the Recorder's step vocabulary. Every value
// Mill accepts is listed here; an unknown type is refused at intake
// rather than sent to a browser that cannot run it.
type StepType string

// The Recorder's step types. A flow may only carry these -- a value
// outside this set fails Validate, so a runner never has to guess.
const (
	StepNavigate          StepType = "navigate"
	StepClick             StepType = "click"
	StepDoubleClick       StepType = "doubleClick"
	StepHover             StepType = "hover"
	StepChange            StepType = "change"
	StepKeyDown           StepType = "keyDown"
	StepKeyUp             StepType = "keyUp"
	StepScroll            StepType = "scroll"
	StepWaitForElement    StepType = "waitForElement"
	StepWaitForExpression StepType = "waitForExpression"
	StepSetViewport       StepType = "setViewport"
	StepClose             StepType = "close"
	StepEmulateNetwork    StepType = "emulateNetworkConditions"
)

// knownStepTypes backs Validate's membership check.
var knownStepTypes = map[StepType]bool{
	StepNavigate: true, StepClick: true, StepDoubleClick: true,
	StepHover: true, StepChange: true, StepKeyDown: true, StepKeyUp: true,
	StepScroll: true, StepWaitForElement: true, StepWaitForExpression: true,
	StepSetViewport: true, StepClose: true, StepEmulateNetwork: true,
}

// DefaultStepTimeoutMS is the Recorder's own per-step default: a step
// that names no timeout of its own waits this long before failing.
const DefaultStepTimeoutMS = 5000

// AssertedEvent is the Recorder's navigation assertion -- a step that
// causes a page load carries one, and the runner waits for that load
// before advancing.
type AssertedEvent struct {
	Type  string `json:"type"`
	URL   string `json:"url,omitempty"`
	Title string `json:"title,omitempty"`
}

// Step is one recorded interaction, field-for-field the Recorder's own
// shape. Selectors is a fallback CHAIN OF CHAINS: the outer slice is
// tried in order, and the first inner chain that resolves an element
// wins -- that redundancy is what survives a page whose CSS classes
// changed but whose ARIA role and text did not.
type Step struct {
	Type           StepType        `json:"type"`
	URL            string          `json:"url,omitempty"`
	Selectors      [][]string      `json:"selectors,omitempty"`
	Target         string          `json:"target,omitempty"`
	Value          string          `json:"value,omitempty"`
	Key            string          `json:"key,omitempty"`
	Expression     string          `json:"expression,omitempty"`
	Count          int             `json:"count,omitempty"`
	TimeoutMS      int             `json:"timeout,omitempty"`
	Visible        *bool           `json:"visible,omitempty"`
	OffsetX        float64         `json:"offsetX,omitempty"`
	OffsetY        float64         `json:"offsetY,omitempty"`
	X              float64         `json:"x,omitempty"`
	Y              float64         `json:"y,omitempty"`
	Width          int             `json:"width,omitempty"`
	Height         int             `json:"height,omitempty"`
	AssertedEvents []AssertedEvent `json:"assertedEvents,omitempty"`
}

// UserFlow is a whole recorded flow -- what "Export as JSON" writes in
// DevTools Recorder, accepted verbatim.
type UserFlow struct {
	Title string `json:"title"`
	Steps []Step `json:"steps"`
}

// Timeout reports the step's effective wait, filling in the Recorder's
// default when the step names none.
func (s Step) Timeout() int {
	if s.TimeoutMS > 0 {
		return s.TimeoutMS
	}
	return DefaultStepTimeoutMS
}

// needsSelectors reports whether a step type acts on a page element,
// and therefore cannot run without at least one selector chain.
func needsSelectors(t StepType) bool {
	switch t {
	case StepClick, StepDoubleClick, StepHover, StepChange, StepKeyDown, StepKeyUp, StepWaitForElement:
		return true
	default:
		return false
	}
}

// Validate refuses a flow a runner could not execute: no steps, an
// unknown step type, a navigate with no URL, an element step with no
// selector chain, or a waitForExpression with no expression. The error
// is developer-facing detail; the service layer maps it to the one
// user-facing sentence.
func (f UserFlow) Validate() error {
	if len(f.Steps) == 0 {
		return fmt.Errorf("browserbridge: a flow needs at least one step")
	}
	for i, s := range f.Steps {
		if !knownStepTypes[s.Type] {
			return fmt.Errorf("browserbridge: step %d has an unknown type %q", i, s.Type)
		}
		if s.Type == StepNavigate && strings.TrimSpace(s.URL) == "" {
			return fmt.Errorf("browserbridge: step %d navigates with no url", i)
		}
		if s.Type == StepWaitForExpression && strings.TrimSpace(s.Expression) == "" {
			return fmt.Errorf("browserbridge: step %d waits on an empty expression", i)
		}
		if needsSelectors(s.Type) && len(nonEmptyChains(s.Selectors)) == 0 {
			return fmt.Errorf("browserbridge: step %d has no selector chain", i)
		}
	}
	return nil
}

// nonEmptyChains drops selector chains the Recorder emitted empty --
// exporting a flow whose element had no accessible name leaves one
// behind, and a runner must not count it as a candidate.
func nonEmptyChains(chains [][]string) [][]string {
	kept := make([][]string, 0, len(chains))
	for _, chain := range chains {
		if len(chain) > 0 && strings.TrimSpace(chain[0]) != "" {
			kept = append(kept, chain)
		}
	}
	return kept
}

// FirstSelector is the selector a failure names, so "couldn't find the
// element" points at something the reader can look up in their own
// recording rather than an index.
func (s Step) FirstSelector() string {
	chains := nonEmptyChains(s.Selectors)
	if len(chains) == 0 {
		return ""
	}
	return chains[0][0]
}

// ParseFlow decodes an exported Recorder JSON document, refusing
// anything Validate would refuse.
func ParseFlow(raw []byte) (UserFlow, error) {
	var flow UserFlow
	if err := json.Unmarshal(raw, &flow); err != nil {
		return UserFlow{}, fmt.Errorf("browserbridge: reading the flow: %w", err)
	}
	if err := flow.Validate(); err != nil {
		return UserFlow{}, err
	}
	return flow, nil
}
