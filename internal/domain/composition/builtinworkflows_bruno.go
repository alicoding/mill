package composition

import (
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// The Bruno integration's seeded proof (goal 0308, ADR-0051's "use
// the real tool" rule): Bruno owns authoring and running requests;
// Mill runs its CLI as a guarded shell step and mirrors the JSON
// report into a List. Three existing steps compose it -- nothing new
// in the kernel: code-execution writes the report to a fixed path
// (bru's own exit code is 1 whenever a request fails, so the script
// ends in `; true` and the report body carries the outcome),
// capture-file reads it back (the shell step's combined output is
// command-framed, not raw JSON), apply-list-sync lands it.
const (
	ExampleBrunoRunWorkflowID = "example-bruno-run-workflow"
	ExampleBrunoRunStepID     = "example-bruno-run-step"
	// ExampleBrunoReportPath is the fixed path the script writes and the
	// capture step reads; a fixed path because capture-file takes a
	// literal path, not a shell expansion.
	ExampleBrunoReportPath = "/tmp/mill-bruno-report.json"
)

const exampleBrunoScript = `# Point COLLECTION at a Bruno collection folder (the one holding bruno.json).
COLLECTION="$HOME/bruno/my-collection"
bru run "$COLLECTION" --reporter-json "` + ExampleBrunoReportPath + `" --reporter-skip-body >/dev/null 2>&1; true`

func builtInBrunoWorkflows() []Workflow {
	const (
		triggerID = "example-bruno-trigger"
		captureID = "example-bruno-capture"
		syncID    = "example-bruno-sync"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: ExampleBrunoRunStepID, NodeTypeID: "code-execution", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"envId": execenv.ExampleSafeSandboxID, "source": "literal",
				"script": exampleBrunoScript, "timeoutSeconds": "300",
			}},
		{ID: captureID, NodeTypeID: "capture-file", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"source": "literal", "path": ExampleBrunoReportPath}},
		{ID: syncID, NodeTypeID: "apply-list-sync", Position: Position{X: 0, Y: 300},
			Config: map[string]string{
				"listId": list.ExampleBrunoResultsID, "itemsPath": "results", "keyColumn": "path", "expireMissing": "true",
				"fieldMap": `{"path":"path","name":"name","method":"request.method","status":"status",` +
					`"httpStatus":"response.status","durationMs":"response.duration","error":"error"}`,
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	return []Workflow{{
		ID:    ExampleBrunoRunWorkflowID,
		Label: "Example: Run a Bruno collection",
		Description: "Runs a Bruno collection with the bru CLI and mirrors its report into Example: Bruno results, " +
			"one row per request. Edit the script's COLLECTION path, and give the step an execution environment " +
			"whose PATH can find bru (Capture shell PATH does it). Running a command is an external effect, so " +
			"the run parks for your approval.",
		Nodes: nodes,
		Edges: []Edge{
			{ID: "example-bruno-e0", Source: triggerID, Target: ExampleBrunoRunStepID},
			{ID: "example-bruno-e1", Source: ExampleBrunoRunStepID, Target: captureID},
			{ID: "example-bruno-e2", Source: captureID, Target: syncID},
		},
		BuiltIn: true,
		Seed:    seedorigin.Stamp(1),
	}}
}
