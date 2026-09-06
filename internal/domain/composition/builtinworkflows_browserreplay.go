package composition

import (
	"encoding/json"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// The browser-replay step's seeded proof: a recorded flow, one
// parameter overlaid onto it from the run's own Attributes, and one
// value read back out of the page. It replays against the page Mill
// serves itself, so the example needs no third-party site to be up and
// its markup can never change under the recording.
//
// Disabled by default like every other example that needs a device: it
// cannot run until a browser is paired.
const (
	ExampleBrowserReplayWorkflowID = "example-browser-replay-workflow"
	ExampleBrowserReplayStepID     = "example-browser-replay-step"
	// ExampleBrowserReplayPageURL is where the test page lives on a
	// default install. The two halves it is built from live in the
	// bridge service (its default bind address and the test page's
	// route); executionsvc's seed test pins this literal against them,
	// since a domain package cannot import a service to read them.
	ExampleBrowserReplayPageURL = "http://127.0.0.1:8092/__mill/bridge/test-page"
	// ExampleBrowserReplayText is what the example types into the page
	// when the run names no value of its own.
	ExampleBrowserReplayText = "hello from Mill"
	// ExampleBrowserReplayOutput is the name the extracted text lands
	// under in the step's result document.
	ExampleBrowserReplayOutput = "echoed"
)

// exampleBrowserReplayFlow is the recording the example carries,
// built from the same element ids the test page renders rather than
// pasted as a literal document -- the page and the recording cannot
// drift apart. What a user imports instead is the recorder's own
// export; this is the identical shape.
func exampleBrowserReplayFlow() browserbridge.UserFlow {
	return browserbridge.UserFlow{
		Title: "Echo text on Mill's test page",
		Steps: []browserbridge.Step{
			{
				Type: browserbridge.StepNavigate, URL: ExampleBrowserReplayPageURL,
				AssertedEvents: []browserbridge.AssertedEvent{{Type: "navigation", URL: ExampleBrowserReplayPageURL}},
			},
			{
				Type: browserbridge.StepChange, Value: ExampleBrowserReplayText,
				Selectors: [][]string{{"#" + browserbridge.TestPageInputID}, {"aria/Text to echo"}},
			},
			{
				Type:      browserbridge.StepClick,
				Selectors: [][]string{{"#" + browserbridge.TestPageButtonID}, {"aria/Confirm the connection"}},
			},
			{
				Type:      browserbridge.StepWaitForElement,
				Selectors: [][]string{{"#" + browserbridge.TestPageEchoID}},
				TimeoutMS: browserbridge.DefaultStepTimeoutMS,
			},
		},
	}
}

// mustEncode panics on a value this package itself constructed and
// therefore knows encodes -- a seed that cannot be built is a build
// fault, the same way an unknown node type in a seed already is.
func mustEncode(v any) string {
	encoded, err := json.Marshal(v)
	if err != nil {
		panic("built-in browser-replay seed does not encode: " + err.Error())
	}
	return string(encoded)
}

func builtInBrowserReplayWorkflows() []Workflow {
	const (
		triggerID = "example-browser-replay-trigger"
		captureID = "example-browser-replay-capture"
	)
	parameters := []browserReplayParameter{
		{Name: "pageUrl", StepIndex: 0, Field: string(browserbridge.BindURL), Source: browserReplayAttrSource + "pageUrl"},
		{Name: "text", StepIndex: 1, Field: string(browserbridge.BindValue), Source: browserReplayAttrSource + "text"},
	}
	extract := []browserReplayExtraction{{Name: ExampleBrowserReplayOutput, StepIndex: 3}}

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: captureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "text"}},
		{ID: ExampleBrowserReplayStepID, NodeTypeID: "process-browser-replay", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				"recording":      mustEncode(exampleBrowserReplayFlow()),
				"parameters":     mustEncode(parameters),
				"extract":        mustEncode(extract),
				"timeoutSeconds": "60",
				"browser":        browserMostRecent,
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	return []Workflow{{
		ID:    ExampleBrowserReplayWorkflowID,
		Label: "Example: Replay a browser flow",
		Description: "Types a value into a page Mill serves itself, presses its button, and reads the echoed text back. " +
			"Pair a browser first, then run it. Change what it types with the workflow's own text Attribute. " +
			"Driving a live site is an external effect, so the run parks for your approval.",
		Nodes: nodes,
		Edges: []Edge{
			{ID: "example-browser-replay-e0", Source: triggerID, Target: captureID},
			{ID: "example-browser-replay-e1", Source: captureID, Target: ExampleBrowserReplayStepID},
		},
		Attributes: []AttributeDef{
			{
				Key: "pageUrl", Label: "Page address", Type: typedfield.TypeText,
				Description: "The page the flow opens. Leave it as it is to use the page Mill serves itself.",
				Default:     ExampleBrowserReplayPageURL,
			},
			{
				Key: "text", Label: "Text to type", Type: typedfield.TypeText,
				Description: "What the flow types into the page before pressing the button.",
				Default:     ExampleBrowserReplayText,
			},
		},
		BuiltIn: true,
		// Cannot run until a browser is paired -- the same reason every
		// other device-dependent example ships disabled.
		Disabled: true,
		Seed:     seedorigin.Stamp(1),
	}}
}
