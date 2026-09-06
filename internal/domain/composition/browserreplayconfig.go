package composition

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// The two JSON documents a browser-replay step carries beside its
// recording. Both are authored through the step's own table editors,
// never typed by hand -- but they are persisted as ConfigField text
// like every other node parameter, so both are parsed defensively here
// and every failure arrives as a sentence naming what to fix.

// browserReplayAttrSource marks a parameter whose value comes from one
// of the run's Attributes: "attribute:<name>". Anything else is the
// literal source.
const browserReplayAttrSource = "attribute:"

// browserReplaySourceLiteral is the parameter source that takes the
// value written beside it rather than reading the run.
const browserReplaySourceLiteral = "literal"

// browserReplayParameter is one row of the step's Parameters table.
// StepIndex is 0-based, matching the recording's own step order; every
// sentence built from it counts from 1.
type browserReplayParameter struct {
	Name      string `json:"name"`
	StepIndex int    `json:"stepIndex"`
	Field     string `json:"field"`
	Source    string `json:"source"`
	Literal   string `json:"literal,omitempty"`
}

// browserReplayExtraction is one row of the step's Extract table: the
// output name, and the step whose element text fills it.
type browserReplayExtraction struct {
	Name      string `json:"name"`
	StepIndex int    `json:"stepIndex"`
}

// CodeBadStepConfig is the handle for a Parameters/Extract document
// that isn't readable at all -- distinct from a row that reads fine but
// points at a step the recording doesn't have (CodeBadParameter).
const CodeBadStepConfig = "browser-replay-bad-step-config"

// browserReplayBindings resolves each configured parameter's value from
// the run before anything is sent to a browser: an attribute source
// reads the run's own Attributes, every other source takes the literal
// written beside it. A missing Attribute resolves to "" -- the
// package's own permissive precedent for an unset value.
func browserReplayBindings(raw string, attrs map[string]any) ([]browserbridge.Binding, error) {
	rows, err := browserReplayRows[browserReplayParameter](raw, "Parameters")
	if err != nil {
		return nil, err
	}
	bindings := make([]browserbridge.Binding, 0, len(rows))
	for _, row := range rows {
		if strings.TrimSpace(row.Name) == "" {
			return nil, usererror.New(CodeBadStepConfig, "Every parameter needs a name.")
		}
		bindings = append(bindings, browserbridge.Binding{
			Name:      row.Name,
			StepIndex: row.StepIndex,
			Field:     browserbridge.BindField(row.Field),
			Value:     browserReplayValue(row, attrs),
		})
	}
	return bindings, nil
}

// browserReplayValue reads one parameter's value for this run.
func browserReplayValue(row browserReplayParameter, attrs map[string]any) string {
	name, isAttr := strings.CutPrefix(row.Source, browserReplayAttrSource)
	if !isAttr {
		return row.Literal
	}
	if v, ok := attrs[name]; ok {
		return fmt.Sprintf("%v", v)
	}
	return ""
}

// browserReplayExtractions reads the Extract table, refusing an unnamed
// row rather than producing an output nothing downstream can address.
func browserReplayExtractions(raw string) ([]browserReplayExtraction, error) {
	rows, err := browserReplayRows[browserReplayExtraction](raw, "Extract")
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if strings.TrimSpace(row.Name) == "" {
			return nil, usererror.New(CodeBadStepConfig, "Every extracted value needs a name.")
		}
	}
	return rows, nil
}

// browserReplayRows decodes one of the step's two JSON tables. An empty
// field is an empty table, not a failure: a recording with no
// parameters is the ordinary case.
func browserReplayRows[T any](raw, table string) ([]T, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var rows []T
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return nil, fmt.Errorf("%w: %w",
			usererror.New(CodeBadStepConfig, fmt.Sprintf("The %s list isn't readable. Edit it in the step's own table.", table)), err)
	}
	return rows, nil
}

// browserReplayOutputStep is one row of the step's own result document
// -- what the run receipt's table shows.
type browserReplayOutputStep struct {
	Index  int    `json:"index"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// browserReplayOutput is the whole payload a finished replay leaves:
// every step's outcome, the named text read back out of the page, and
// the files the browser saved. Downloads report where the BROWSER put
// them; nothing here moves a file.
type browserReplayOutput struct {
	Steps     []browserReplayOutputStep `json:"steps"`
	Extracted map[string]string         `json:"extracted"`
	Downloads []browserbridge.Download  `json:"downloads"`
}

// browserReplayPayload builds the result document. Both maps/slices are
// non-nil so the payload's shape is the same whether or not a run
// extracted or downloaded anything -- a consumer indexing into it never
// has to branch on null.
func browserReplayPayload(outcome BrowserReplayOutcome, extractions []browserReplayExtraction) (string, error) {
	byIndex := make(map[int]BrowserReplayStep, len(outcome.Steps))
	out := browserReplayOutput{
		Steps:     make([]browserReplayOutputStep, 0, len(outcome.Steps)),
		Extracted: make(map[string]string, len(extractions)),
		Downloads: outcome.Downloads,
	}
	for _, step := range outcome.Steps {
		byIndex[step.Index] = step
		out.Steps = append(out.Steps, browserReplayOutputStep{Index: step.Index, Status: step.Status, Error: step.Error})
	}
	if out.Downloads == nil {
		out.Downloads = []browserbridge.Download{}
	}
	for _, e := range extractions {
		out.Extracted[e.Name] = byIndex[e.StepIndex].Extracted
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		return "", fmt.Errorf("browser-replay: encoding the result: %w", err)
	}
	return string(encoded), nil
}

// parsePositiveInt reads a whole number greater than zero, refusing
// blanks, negatives and anything unparseable.
func parsePositiveInt(raw string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, err
	}
	if n <= 0 {
		return 0, fmt.Errorf("composition: %d is not a positive whole number", n)
	}
	return n, nil
}
