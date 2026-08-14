package contract_test

import (
	"bytes"
	"testing"

	"github.com/alicoding/mill/internal/contract"
	_ "github.com/alicoding/mill/internal/services/compositionsvc"
	_ "github.com/alicoding/mill/internal/services/configuresvc"
)

// TestContractSchemas_MatchCommitted is ADR-0036's drift gate: it
// regenerates every registered family's schema in memory and byte-
// compares against the committed, embedded file, so a type change
// without a `go generate ./internal/contract` run fails the same way a
// hand-edited schema file does.
func TestContractSchemas_MatchCommitted(t *testing.T) {
	families := contract.Families()
	if len(families) == 0 {
		t.Fatal("no families registered -- the blank imports above should have triggered at least one init()")
	}

	fresh, err := contract.GenerateAll()
	if err != nil {
		t.Fatalf("GenerateAll: %v", err)
	}

	for _, family := range families {
		committed, err := contract.CommittedSchemas.ReadFile("schemas/" + family + ".schema.json")
		if err != nil {
			t.Errorf("family %q: no committed schema file -- run `go generate ./internal/contract`: %v", family, err)
			continue
		}
		if !bytes.Equal(fresh[family], committed) {
			t.Errorf("family %q: committed schema is stale -- run `go generate ./internal/contract` and commit the result", family)
		}
	}
}

// TestValidateImportSchema pins ADR-0036 decision 2's import rule
// across the cases a real export can carry.
func TestValidateImportSchema(t *testing.T) {
	cases := []struct {
		name    string
		family  string
		schema  string
		wantErr bool
	}{
		{"absent accepted", "workflow", "", false},
		{"matching id accepted", "workflow", "mill://schema/workflow/v1", false},
		{"wrong family rejected", "workflow", "mill://schema/request/v1", true},
		{"unsupported major rejected", "workflow", "mill://schema/workflow/v99", true},
		{"garbage rejected", "workflow", "not-a-schema-id", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := contract.ValidateImportSchema(tc.family, tc.schema)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateImportSchema(%q, %q) error = %v, wantErr %v", tc.family, tc.schema, err, tc.wantErr)
			}
		})
	}
}
