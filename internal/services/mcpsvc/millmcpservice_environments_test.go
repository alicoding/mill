package mcpsvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/environment"
)

// The index answers what can be substituted and what is not ready --
// and never a value, plain or secret.
func TestEnvironmentIndex_CarriesNamesAndStatusNeverValues(t *testing.T) {
	envs := []environment.Environment{{
		ID: "env-1", Label: "Sandbox",
		Vars: []environment.Variable{
			{Key: "API_BASE", Value: "https://sandbox.example.test"},
			{Key: "API_TOKEN", Value: "vault:entry-1", Secret: true},
			{Key: "UNSET", Secret: true},
		},
	}}

	data, err := json.Marshal(environmentIndex(envs))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	text := string(data)
	for _, forbidden := range []string{"sandbox.example.test", "vault:entry-1"} {
		if strings.Contains(text, forbidden) {
			t.Errorf("index carries %q, which is a value the boundary must not cross:\n%s", forbidden, text)
		}
	}

	var got []environmentIndexEntry
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("index is not valid JSON: %v", err)
	}
	if len(got) != 1 || got[0].ID != "env-1" || got[0].Label != "Sandbox" || got[0].SecretCount != 2 {
		t.Fatalf("index = %+v", got)
	}
	if len(got[0].Variables) != 3 {
		t.Fatalf("variables = %+v, want all three names", got[0].Variables)
	}
	if got[0].Variables[0].Secret || got[0].Variables[1].NeedsValue || !got[0].Variables[2].NeedsValue {
		t.Errorf("variable flags = %+v, want only the reference-less secret marked needsValue", got[0].Variables)
	}
}
