package contract_test

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/alicoding/mill/internal/contract"
	_ "github.com/alicoding/mill/internal/services/compositionsvc"
	_ "github.com/alicoding/mill/internal/services/configuresvc"
	_ "github.com/alicoding/mill/internal/services/executionsvc"
)

// TestRootContractDocument_MatchCommitted is the same regenerate-and-
// compare drift gate TestContractSchemas_MatchCommitted runs for the
// per-family schemas (contract_test.go), applied to the root document
// (goal 0052 item 6): a node-type or registered-family change without a
// `go generate ./internal/contract` run fails this the same way a
// hand-edited contract.json does.
func TestRootContractDocument_MatchCommitted(t *testing.T) {
	fresh, err := contract.GenerateDocument()
	if err != nil {
		t.Fatalf("GenerateDocument: %v", err)
	}
	committed, err := contract.CommittedDocument.ReadFile("contract.json")
	if err != nil {
		t.Fatalf("read committed contract.json: %v", err)
	}
	if !bytes.Equal(fresh, committed) {
		t.Error("committed contract.json is stale -- run `go generate ./internal/contract` and commit the result")
	}
}

// TestRootContractDocument_Deterministic guards the byte-determinism
// GenerateDocument shares with GenerateAll (struct field order, sorted
// map keys, NodeTypes()'s own stable sort) -- two independent
// generations of the same registry must be byte-identical, the
// property that makes a committed, diffed document meaningful.
func TestRootContractDocument_Deterministic(t *testing.T) {
	first, err := contract.GenerateDocument()
	if err != nil {
		t.Fatalf("GenerateDocument (1st): %v", err)
	}
	second, err := contract.GenerateDocument()
	if err != nil {
		t.Fatalf("GenerateDocument (2nd): %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Error("GenerateDocument is not deterministic across two runs")
	}
}

// TestRootContractDocument_OmitsManifest pins ADR-0036 decision 4: the
// committed document never carries a manifest field, so it stays
// byte-identical across app upgrades when nothing else changed.
func TestRootContractDocument_OmitsManifest(t *testing.T) {
	committed, err := contract.CommittedDocument.ReadFile("contract.json")
	if err != nil {
		t.Fatalf("read committed contract.json: %v", err)
	}
	if bytes.Contains(committed, []byte(`"manifest"`)) {
		t.Error("committed contract.json carries a manifest field -- ADR-0036 decision 4 requires it stay a live, served-only addition")
	}
}

// TestServed_InjectsManifestOverCommittedDocument proves Served
// attaches the given manifest to the exact committed static document --
// the served/exported form's own anti-drift property.
func TestServed_InjectsManifestOverCommittedDocument(t *testing.T) {
	manifest := contract.BuildManifest("9.9.9-test", "abc123", true, false)
	data, err := contract.Served(manifest)
	if err != nil {
		t.Fatalf("Served: %v", err)
	}
	if !bytes.Contains(data, []byte(`"version": "9.9.9-test"`)) {
		t.Errorf("Served output missing injected manifest version:\n%s", data)
	}
	if !bytes.Contains(data, []byte(`"stepTypes"`)) {
		t.Errorf("Served output missing the static document's stepTypes:\n%s", data)
	}
	if !bytes.Contains(data, []byte(`"nodeTypes"`)) {
		t.Errorf("Served output missing the static document's legacy nodeTypes alias:\n%s", data)
	}
}

// TestDocument_StepTypesAndNodeTypesStayIdentical pins the alias
// contract: NodeTypes is StepTypes under its legacy key, so the two
// must always carry byte-identical content, never drift apart.
func TestDocument_StepTypesAndNodeTypesStayIdentical(t *testing.T) {
	data, err := contract.GenerateDocument()
	if err != nil {
		t.Fatalf("GenerateDocument: %v", err)
	}
	var doc contract.Document
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("decode generated document: %v", err)
	}
	if len(doc.StepTypes) == 0 {
		t.Fatal("generated document has no stepTypes")
	}
	stepJSON, err := json.Marshal(doc.StepTypes)
	if err != nil {
		t.Fatalf("marshal StepTypes: %v", err)
	}
	nodeJSON, err := json.Marshal(doc.NodeTypes)
	if err != nil {
		t.Fatalf("marshal NodeTypes: %v", err)
	}
	if string(stepJSON) != string(nodeJSON) {
		t.Errorf("stepTypes diverges from its legacy nodeTypes alias:\nstepTypes: %s\nnodeTypes: %s", stepJSON, nodeJSON)
	}
}
