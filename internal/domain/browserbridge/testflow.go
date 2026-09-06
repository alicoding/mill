package browserbridge

// TestPageButtonID and TestPageReadyID are the two element ids the
// connection test's page and its flow must agree on. They live here,
// beside the flow, so the page markup and the steps can never drift
// apart silently.
const (
	TestPageButtonID = "mill-bridge-button"
	TestPageReadyID  = "mill-bridge-ready"
	// TestPageInputID and TestPageEchoID are the page's parameter
	// surface: whatever is typed into the input is echoed into the echo
	// element when the button is pressed. The seeded "Replay a browser
	// flow" example binds a parameter into the input and reads the echo
	// back, so a recorded flow's parameters and extraction are proven
	// against a page that cannot change under them.
	TestPageInputID = "mill-bridge-input"
	TestPageEchoID  = "mill-bridge-echo"
)

// TestFlowSteps is how many steps the connection test replays -- the
// number the result sentence reports back.
const TestFlowSteps = 3

// TestFlow is the built-in flow behind "Test the connection": open a
// page Mill serves itself, press its button, wait for what the press
// reveals. It exercises navigation, selector resolution and a wait --
// the three things every recorded flow depends on -- against a page
// whose markup cannot change under the test.
//
// The selector chains are deliberately plural, in the same order a
// real Recorder export lists them (CSS, then ARIA, then text), so the
// runner's fallback path is exercised by the test flow too rather than
// only by flows a user recorded.
func TestFlow(pageURL string) UserFlow {
	return UserFlow{
		Title: "Mill connection test",
		Steps: []Step{
			{
				Type: StepNavigate,
				URL:  pageURL,
				AssertedEvents: []AssertedEvent{
					{Type: "navigation", URL: pageURL},
				},
			},
			{
				Type: StepClick,
				Selectors: [][]string{
					{"#" + TestPageButtonID},
					{"aria/Confirm the connection"},
					{"text/Confirm the connection"},
				},
			},
			{
				Type: StepWaitForElement,
				Selectors: [][]string{
					{"#" + TestPageReadyID},
					{"text/Connected"},
				},
				TimeoutMS: DefaultStepTimeoutMS,
			},
		},
	}
}
