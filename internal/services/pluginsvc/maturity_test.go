package pluginsvc

import (
	"reflect"
	"strings"
	"testing"
)

// TestMaturity_FamiliesFollowTheManifest pins Families() to
// ManifestContributes' own json tags, computed independently of
// Families() itself (a struct literal in this test cannot add a
// field ManifestContributes doesn't have, so the only way to catch
// drift is comparing two independent reads of the same struct type).
func TestMaturity_FamiliesFollowTheManifest(t *testing.T) {
	rt := reflect.TypeOf(ManifestContributes{})
	var want []string
	for i := 0; i < rt.NumField(); i++ {
		tag := strings.Split(rt.Field(i).Tag.Get("json"), ",")[0]
		if tag == "" || tag == "-" {
			continue
		}
		want = append(want, tag)
	}
	got := Families()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Families() = %v, want %v (ManifestContributes' own json tags, in struct order)", got, want)
	}
	if len(got) == 0 {
		t.Fatal("Families() returned none -- ManifestContributes lost every json tag")
	}
}

// TestMaturity_StableFamiliesKeepTheirEvidence is the build gate: a
// family FamilyStability calls stable must keep full evidence in the
// REAL repo, on every run. A stable family losing a cell here is a
// silent regression -- this test is what makes it loud.
func TestMaturity_StableFamiliesKeepTheirEvidence(t *testing.T) {
	repoRoot := "../../.."
	evidence := GatherEvidence(repoRoot)
	for family, level := range FamilyStability {
		if level != StabilityStable {
			continue
		}
		e, ok := evidence[family]
		if !ok {
			t.Errorf("stable family %q has no evidence row -- did it leave ManifestContributes?", family)
			continue
		}
		if !e.complete() {
			t.Errorf("stable family %q regressed: %+v (a stable family's evidence must stay complete; see maturity.go's promotion table)", family, e)
		}
	}
}

func TestMaturity_Flags(t *testing.T) {
	complete := Evidence{Conformance: true, Example: true, E2E: true, Docs: true, SDKTypes: true, MCP: "yes"}
	completeNA := Evidence{Conformance: true, Example: true, E2E: true, Docs: true, SDKTypes: true, MCP: "n/a"}
	incomplete := Evidence{Conformance: true, Example: true, E2E: false, Docs: true, SDKTypes: true, MCP: "yes"}
	blockedByMCP := Evidence{Conformance: true, Example: true, E2E: true, Docs: true, SDKTypes: true, MCP: "no"}

	cases := []struct {
		name  string
		level Stability
		e     Evidence
		want  []string
	}{
		{"experimental, complete, MCP yes -> ready", StabilityExperimental, complete, []string{"ready-to-promote"}},
		{"experimental, complete, MCP n/a -> ready", StabilityExperimental, completeNA, []string{"ready-to-promote"}},
		{"experimental, incomplete -> no flag", StabilityExperimental, incomplete, nil},
		{"experimental, MCP no blocks readiness", StabilityExperimental, blockedByMCP, nil},
		{"stable, complete -> no flag", StabilityStable, complete, nil},
		{"stable, incomplete -> regressed", StabilityStable, incomplete, []string{"regressed"}},
		{"stable, MCP no -> regressed", StabilityStable, blockedByMCP, []string{"regressed"}},
		{"deprecated, incomplete -> no flag", StabilityDeprecated, incomplete, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Flags(c.level, c.e)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("Flags(%v, %+v) = %v, want %v", c.level, c.e, got, c.want)
			}
		})
	}
}
