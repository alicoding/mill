package pluginsvc

import (
	"strings"
	"testing"
)

// Standard rule 35 (docs/goals/0349 S2c): a when clause naming
// plugin.<key> where this plugin's own scripts never write that key
// with context.set is likely a typo -- advisory, like rule 34.

func TestConformUndeclaredContextKeys(t *testing.T) {
	m := Manifest{Contributes: ManifestContributes{Menus: map[string][]MenuItemContribution{
		"view/title": {{Command: "probe.sendAgain", When: "plugin.hasResult"}},
	}}}
	if warnings := conformUndeclaredContextKeys(m, map[string]string{
		"main.js": "export function activate(api) {}",
	}); len(warnings) != 1 {
		t.Fatalf("warnings = %v, want exactly one (the key is never set)", warnings)
	} else if !strings.Contains(warnings[0], "standard rule 35") || !strings.Contains(warnings[0], "plugin.hasResult") || !strings.Contains(warnings[0], "probe.sendAgain") {
		t.Fatalf("warning = %q, want it to name the rule, the key and the command", warnings[0])
	}

	// api.context.set(...) -- the same-DOM/framed-activation spelling.
	if warnings := conformUndeclaredContextKeys(m, map[string]string{
		"main.js": `export function activate(api) { api.context.set('hasResult', true) }`,
	}); len(warnings) != 0 {
		t.Fatalf("warnings = %v, want none once main.js sets the key", warnings)
	}

	// call('context.set', ...) -- the entry-page/framed spelling.
	if warnings := conformUndeclaredContextKeys(m, map[string]string{
		"tester.js": `mill.call('context.set', 'hasResult', true)`,
	}); len(warnings) != 0 {
		t.Fatalf("warnings = %v, want none once an entry page sets the key", warnings)
	}
}

func TestConformUndeclaredContextKeys_IgnoresAQuotedLiteralThatIsNotAFactReference(t *testing.T) {
	m := Manifest{Contributes: ManifestContributes{Menus: map[string][]MenuItemContribution{
		"editor/context": {{Command: "probe.run", When: `objectKind == "plugin.decoy"`}},
	}}}
	if warnings := conformUndeclaredContextKeys(m, map[string]string{"main.js": "export function activate() {}"}); len(warnings) != 0 {
		t.Fatalf("warnings = %v, want none: \"plugin.decoy\" is a quoted STRING VALUE, not a fact reference", warnings)
	}
}

// TestConformStandardWarnings_Rule35_UndeclaredContextKey proves the
// wiring through ConformStandardWarnings, the way conform_standard_test.go's
// own rule-3/rule-9 pairs do: a real plugin folder, not just the pure
// function above.
func TestConformStandardWarnings_Rule35_UndeclaredContextKey(t *testing.T) {
	dir := newFixture(t, "ctxy", validIconManifest("ctxy", "Ctxy", `"contributes":{"menus":{"view/title":[{"command":"ctxy.sendAgain","when":"plugin.hasResult"}]}}`), map[string]string{
		"main.js": "export function activate(api) { api.registerCommand({ id: 'ctxy.sendAgain', label: 'Send again', run: () => {} }) }",
	})
	warnings := strings.Join(ConformStandardWarnings(dir), "\n")
	if !strings.Contains(warnings, "standard rule 35") {
		t.Fatalf("want a rule-35 warning, got %q", warnings)
	}

	clean := newFixture(t, "ctxy-ok", validIconManifest("ctxy-ok", "Ctxy ok", `"contributes":{"menus":{"view/title":[{"command":"ctxy-ok.sendAgain","when":"plugin.hasResult"}]}}`), map[string]string{
		"main.js":   "export function activate(api) { api.registerCommand({ id: 'ctxy-ok.sendAgain', label: 'Send again', run: () => {} }) }",
		"tester.js": "mill.call('context.set', 'hasResult', true)",
	})
	if warnings := ConformStandardWarnings(clean); containsRule35(warnings) {
		t.Fatalf("a plugin that sets the key should carry no rule-35 warning, got %v", warnings)
	}
}

func containsRule35(warnings []string) bool {
	for _, w := range warnings {
		if strings.Contains(w, "standard rule 35") {
			return true
		}
	}
	return false
}

func TestFactIdentifiers(t *testing.T) {
	got := factIdentifiers(`objectKind == 'ink' && plugin.hasResult`)
	want := map[string]bool{"objectKind": true, "plugin.hasResult": true}
	if len(got) != 2 {
		t.Fatalf("factIdentifiers = %v, want 2 identifiers", got)
	}
	for _, id := range got {
		if !want[id] {
			t.Fatalf("factIdentifiers = %v, want only %v", got, want)
		}
	}
}
