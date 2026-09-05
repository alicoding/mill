package pluginsvc

import (
	"os"
	"path/filepath"
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

// e2eDetectionGap names a stable family whose E2E cell this test
// tolerates as incomplete: real coverage exists (frontend/e2e's own
// spec, named next to the entry below) but hasE2E's token rule cannot
// prove it, because the family is declarative -- no SDK registration
// call exists for it to search for, per maturity.go's promotion
// table. The generated ledger still reports the honest "regressed"
// flag; only this build gate skips the cell, so a real regression on
// any OTHER cell, or on any family not listed here, still fails loud.
// Remove an entry the moment hasE2E gains a family-specific token.
var e2eDetectionGap = map[string]bool{
	// themes: proven by frontend/e2e/theming.spec.ts's plugin-theme
	// test (the Scribble example's "Sepia"/"From Scribble" contributed
	// theme, applied across windows) -- goal 0348 follow-up.
	"themes": true,
}

// TestMaturity_StableFamiliesKeepTheirEvidence is the build gate: a
// family FamilyStability calls stable must keep full evidence in the
// REAL repo, on every run. A stable family losing a cell here is a
// silent regression -- this test is what makes it loud, except for
// the named, tracked detection gaps above.
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
		if e2eDetectionGap[family] {
			e.E2E = true
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

// writeE2ESpec writes repoRoot/frontend/e2e/<name> with body, creating
// the directory tree the first time a test calls it.
func writeE2ESpec(t *testing.T, repoRoot, name, body string) {
	t.Helper()
	dir := filepath.Join(repoRoot, "frontend", "e2e")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

// TestHasE2E_BareWholeWordNoLongerMatches pins the goal 0348 follow-up
// regression: a spec whose only mention of a family name is unrelated
// prose (the shape that made "themes" and "steps" false positives
// under the old whole-word rule) must not count as evidence.
func TestHasE2E_BareWholeWordNoLongerMatches(t *testing.T) {
	repoRoot := t.TempDir()
	writeE2ESpec(t, repoRoot, "dark-mode.spec.ts", "// this test also exercises the app's color themes and tools menu\n")
	if hasE2E(repoRoot, "themes") {
		t.Error(`hasE2E(repoRoot, "themes") = true, want false: only a bare-word match exists`)
	}
	if hasE2E(repoRoot, "tools") {
		t.Error(`hasE2E(repoRoot, "tools") = true, want false: only a bare-word match exists`)
	}
}

// TestHasE2E_FilenameConvention covers the runtime-plugin-<family>*
// naming route, family name and kebab-case form alike.
func TestHasE2E_FilenameConvention(t *testing.T) {
	repoRoot := t.TempDir()
	writeE2ESpec(t, repoRoot, "runtime-plugin-steps.spec.ts", "test('steps run', () => {})\n")
	writeE2ESpec(t, repoRoot, "runtime-plugin-canvas-objects-extra.spec.ts", "test('canvas objects', () => {})\n")
	if !hasE2E(repoRoot, "steps") {
		t.Error(`hasE2E(repoRoot, "steps") = false, want true: runtime-plugin-steps.spec.ts exists`)
	}
	if !hasE2E(repoRoot, "canvasObjects") {
		t.Error(`hasE2E(repoRoot, "canvasObjects") = false, want true: kebab-case runtime-plugin-canvas-objects-extra.spec.ts exists`)
	}
}

// TestHasE2E_RegistrationCallAndContributesLiteral covers the second
// route: a family's own SDK registration call, or the literal
// contributes.<family> text, inside any spec file regardless of name.
func TestHasE2E_RegistrationCallAndContributesLiteral(t *testing.T) {
	repoRoot := t.TempDir()
	writeE2ESpec(t, repoRoot, "some-spec.spec.ts", "api.registerCapture({ id: 'thought' })\n")
	if !hasE2E(repoRoot, "captures") {
		t.Error(`hasE2E(repoRoot, "captures") = false, want true: registerCapture appears in a spec`)
	}
	writeE2ESpec(t, repoRoot, "another-spec.spec.ts", "expect(refused).toContainText('contributes.network')\n")
	if !hasE2E(repoRoot, "network") {
		t.Error(`hasE2E(repoRoot, "network") = false, want true: literal contributes.network appears in a spec`)
	}
}

// TestHasE2E_FixtureManifest covers the third route: an e2e fixture
// plugin's own manifest.json declaring a non-empty contributes.<family>.
func TestHasE2E_FixtureManifest(t *testing.T) {
	repoRoot := t.TempDir()
	dir := filepath.Join(repoRoot, "frontend", "e2e", "fixtures", "sample-plugin")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"sample-plugin","contributes":{"views":[{"id":"issues","title":"Issues"}]}}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	if !hasE2E(repoRoot, "views") {
		t.Error(`hasE2E(repoRoot, "views") = false, want true: fixture manifest declares contributes.views`)
	}
	if hasE2E(repoRoot, "commands") {
		t.Error(`hasE2E(repoRoot, "commands") = true, want false: fixture manifest never declares contributes.commands`)
	}
}
