package executionsvc

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

// receiptStepFrom finds the process-run-receipt step in detail --
// mirrors codeStepFrom (codeexec_seed_test.go)'s identical shape for a
// different node type.
func receiptStepFrom(t *testing.T, detail RunDetail) RunStep {
	t.Helper()
	for _, s := range detail.Steps {
		if s.NodeTypeID == "process-run-receipt" {
			return s
		}
	}
	t.Fatalf("run %s has no process-run-receipt step in its detail", detail.RunID)
	return RunStep{}
}

// TestSeededRunReceiptExample_RunsEndToEndAndValidatesAgainstSchema
// proves the real seed end to end AND closes goal 0052's own loop
// between slices: the receipt this seed actually produces validates
// against the committed mill://schema/receipt/v1 JSON Schema
// (santhosh-tekuri/jsonschema/v6 -- already in this module's dependency
// graph as an indirect dependency of modelcontextprotocol/go-sdk before
// this test started using it directly, so no new external dependency,
// just promoted to a direct require), not just against
// composition.RunEvidence's own Go decode.
func TestSeededRunReceiptExample_RunsEndToEndAndValidatesAgainstSchema(t *testing.T) {
	skipUnlessRealDesktopClipboard(t)

	exec, comp := newTestExecutionService(t)
	exec.SetVersion("9.9.9-test")

	wfID := findBuiltInWorkflowID(t, comp, "Example: Run receipt")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	waitFor(t, "run to succeed", 15*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})

	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	receiptStep := receiptStepFrom(t, detail)
	if receiptStep.Status != "succeeded" {
		t.Fatalf("process-run-receipt step status = %q, want succeeded (error: %q)", receiptStep.Status, receiptStep.Error)
	}
	receiptJSON := receiptStep.Output

	var evidence composition.RunEvidence
	if err := json.Unmarshal([]byte(receiptJSON), &evidence); err != nil {
		t.Fatalf("receipt output isn't valid JSON: %v\n%s", err, receiptJSON)
	}
	if evidence.RunID != summary.RunID {
		t.Errorf("evidence.RunID = %q, want %q", evidence.RunID, summary.RunID)
	}
	if evidence.WorkflowID != wfID {
		t.Errorf("evidence.WorkflowID = %q, want %q", evidence.WorkflowID, wfID)
	}
	if evidence.Schema != contract.SchemaID("receipt") {
		t.Errorf("evidence.Schema = %q, want %q", evidence.Schema, contract.SchemaID("receipt"))
	}
	// Only the inject step ran before this one -- the trigger never
	// checkpoints (execute.go), and this node's own step hasn't been
	// checkpointed yet when the lookup runs mid-step.
	if len(evidence.Steps) != 1 || evidence.Steps[0].NodeTypeID != "process-inject-text" {
		t.Errorf("evidence.Steps = %+v, want exactly the one prior process-inject-text step", evidence.Steps)
	}
	if evidence.Build.Version != "9.9.9-test" {
		t.Errorf("evidence.Build.Version = %q, want the wired app version", evidence.Build.Version)
	}

	schemaBytes, err := contract.CommittedSchemas.ReadFile("schemas/receipt.schema.json")
	if err != nil {
		t.Fatalf("read committed receipt schema: %v", err)
	}
	schemaDoc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaBytes))
	if err != nil {
		t.Fatalf("decode receipt schema: %v", err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("mill://schema/receipt/v1", schemaDoc); err != nil {
		t.Fatalf("AddResource: %v", err)
	}
	schema, err := compiler.Compile("mill://schema/receipt/v1")
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	instance, err := jsonschema.UnmarshalJSON(bytes.NewReader([]byte(receiptJSON)))
	if err != nil {
		t.Fatalf("decode receipt instance: %v", err)
	}
	if err := schema.Validate(instance); err != nil {
		t.Errorf("receipt does not validate against its own committed mill://schema/receipt/v1: %v\nreceipt:\n%s", err, receiptJSON)
	}
}
