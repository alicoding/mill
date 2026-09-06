package composition

import (
	"errors"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// BrowserReplayStep is one step of a finished replay, as the browser
// reported it back.
type BrowserReplayStep struct {
	Index     int
	Status    string
	Error     string
	Extracted string
}

// BrowserReplayOutcome is a whole finished replay: every step the
// browser reported, and the files it saved on the way.
type BrowserReplayOutcome struct {
	Steps     []BrowserReplayStep
	Downloads []browserbridge.Download
}

// browserReplayFn is the seam onto the paired browser. It defaults to
// refusing, so a step run before the bridge is wired fails with a
// sentence rather than silently doing nothing -- the same fail-loud
// default lookupMCPServerFn takes.
var browserReplayFn = func(_ browserbridge.UserFlow, _ time.Duration) (BrowserReplayOutcome, error) {
	return BrowserReplayOutcome{}, browserbridge.ErrNoBrowser()
}

// SetBrowserReplayer wires how a browser-replay step reaches a paired
// browser. Called once at wiring time; this package never depends on
// the bridge service directly.
//
// No context crosses this seam: a node's exec signature carries none,
// and timeout is the whole budget a run may take, so the composition
// root supplies the cancellation context on the other side rather than
// this package inventing one.
func SetBrowserReplayer(fn func(flow browserbridge.UserFlow, timeout time.Duration) (BrowserReplayOutcome, error)) {
	browserReplayFn = fn
}

// browserReplayDefaultTimeout is the whole-flow budget a step gets when
// it names none -- long enough for a handful of page loads, short
// enough that a tab left on a login screen reports rather than hangs.
const browserReplayDefaultTimeout = 60

// browserMostRecent is the only browser choice today: whichever paired
// browser connected last. The field exists so a named browser can be
// added without a schema change; its value is the sentence a reader
// picks, because an Options field renders its stored values verbatim.
const browserMostRecent = "Most recently connected"

func init() {
	RegisterNodeType(NodeType{
		ID: "process-browser-replay", Kind: KindProcess,
		Effect: guardrail.ClassExternal,
		// Advanced: the recording comes from another tool's export, and
		// a parameter has to name a step inside it.
		Complexity:  ComplexityAdvanced,
		Consumes:    []PayloadKind{PayloadAny},
		Produces:    PayloadProduce{Kind: PayloadJSON},
		Output:      "each step's result, the text extracted, and any downloads",
		Label:       "Replay in the browser",
		Description: "Runs a recorded browser flow in your paired browser, signed in as you are.",
		ConfigFields: []ConfigField{
			{
				Key: "recording", Label: "Recording", Multiline: true,
				Description: "The flow exported as JSON from the browser's own recorder. Import it rather than typing it.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "parameters", Label: "Parameters", Multiline: true,
				Description: "Values to replace in the recording before it runs, each naming one step and one of its fields.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "extract", Label: "Extract", Multiline: true,
				Description: "Text to read back out of the page, each naming a step that waits for the element to read.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "timeoutSeconds", Label: "Timeout (seconds)",
				Description: "How long the whole flow may take before the run fails.",
				Default:     fmt.Sprint(browserReplayDefaultTimeout), Type: FieldNumber,
			},
			{
				Key: "browser", Label: "Browser",
				Description: "Which paired browser runs the flow.",
				Default:     browserMostRecent, Options: []string{browserMostRecent}, Type: FieldOptions,
			},
		},
	}, execBrowserReplay)
}

// execBrowserReplay overlays this run's parameters onto a COPY of the
// recording, replays it in the paired browser, and replaces the payload
// with the run's own result document.
func execBrowserReplay(node Node, ctx ExecContext) (ExecContext, error) {
	flow, err := browserbridge.ParseFlow([]byte(node.Config["recording"]))
	if err != nil {
		return ctx, browserbridge.ErrBadRecording(err)
	}

	bindings, err := browserReplayBindings(node.Config["parameters"], ctx.Attributes)
	if err != nil {
		return ctx, err
	}
	bound, err := browserbridge.Overlay(flow, bindings)
	if err != nil {
		return ctx, err
	}

	extractions, err := browserReplayExtractions(node.Config["extract"])
	if err != nil {
		return ctx, err
	}

	outcome, err := browserReplayFn(bound, browserReplayTimeout(node.Config["timeoutSeconds"]))
	if err != nil {
		return ctx, browserReplayFailure(err, bound, outcome)
	}

	payload, err := browserReplayPayload(outcome, extractions)
	if err != nil {
		return ctx, err
	}
	ctx.Payload = payload
	return ctx, nil
}

// browserReplayTimeout reads the configured whole-flow budget, falling
// back to the default for an unset or unreadable value rather than
// running unbounded.
func browserReplayTimeout(raw string) time.Duration {
	seconds := browserReplayDefaultTimeout
	if n, err := parsePositiveInt(raw); err == nil {
		seconds = n
	}
	return time.Duration(seconds) * time.Second
}

// browserReplayFailure names the step that stopped the run whenever the
// browser reported one. A selector miss is the recording's most common
// way to go stale, and naming the step and its selector is what lets a
// reader find it in their own recording -- the browser's own phrasing
// knows the step number but not the recording it came from.
func browserReplayFailure(err error, flow browserbridge.UserFlow, outcome BrowserReplayOutcome) error {
	var declared *usererror.Error
	if !errors.As(err, &declared) || declared.Code != browserbridge.CodeReplayFailed {
		return err
	}
	for _, step := range outcome.Steps {
		if step.Status != browserbridge.StatusFailed || step.Index < 0 || step.Index >= len(flow.Steps) {
			continue
		}
		return browserbridge.ErrSelectorMiss(step.Index+1, flow.Steps[step.Index].FirstSelector())
	}
	return err
}
