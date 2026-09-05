package pluginsvc

import (
	"strings"
	"testing"
)

// Standard rule 21 and the load-blocking entry validation beneath it
// (docs/goals/0349). The error text IS the contract an author reads,
// so each case pins the sentence, not just the failure.

const entryPage = `<!doctype html><html><head><link rel="stylesheet" href="view.css"></head><body><script src="view.js"></script></body></html>`

func viewEntryManifest(id string) string {
	return validIconManifest(id, "Entry probe", `"contributes":{"views":[{"id":"panel","title":"Panel","entry":"view.html"}]}`)
}

func TestValidateViews_EntryMustBeHTML(t *testing.T) {
	problem := validateViews([]ViewContribution{{ID: "panel", Title: "Panel", Entry: "view.txt"}})
	if problem != `contributed view "panel" entry "view.txt" must be an .html file` {
		t.Fatalf("unexpected problem: %q", problem)
	}
	if problem := validateViews([]ViewContribution{{ID: "panel", Title: "Panel", Entry: "pages/view.html"}}); problem != "" {
		t.Fatalf("a nested entry page should validate, got %q", problem)
	}
}

func TestValidateViews_EntryMustStayInsideTheFolder(t *testing.T) {
	for _, entry := range []string{"../other/view.html", "/etc/view.html", "https://example.com/view.html"} {
		problem := validateViews([]ViewContribution{{ID: "panel", Title: "Panel", Entry: entry}})
		if !strings.Contains(problem, "must be a file inside the plugin folder") {
			t.Fatalf("entry %q: unexpected problem %q", entry, problem)
		}
	}
}

func TestValidateCaptures_EntryFollowsTheSameRule(t *testing.T) {
	problem := validateCaptures([]CaptureContribution{{ID: "quick", Label: "Quick", Entry: "quick.js"}})
	if problem != `contributed capture "quick" entry "quick.js" must be an .html file` {
		t.Fatalf("unexpected problem: %q", problem)
	}
}

func TestEntryFileProblem_MissingPageBlocksTheLoad(t *testing.T) {
	m := Manifest{Contributes: ManifestContributes{
		Views:    []ViewContribution{{ID: "panel", Title: "Panel", Entry: "view.html"}},
		Captures: []CaptureContribution{{ID: "quick", Label: "Quick", Entry: "quick.html"}},
	}}
	present := map[string]bool{"quick.html": true}
	if problem := entryFileProblem(m, func(rel string) bool { return present[rel] }); problem != `view "panel" entry "view.html" is missing` {
		t.Fatalf("unexpected problem: %q", problem)
	}
	present["view.html"] = true
	if problem := entryFileProblem(m, func(rel string) bool { return present[rel] }); problem != "" {
		t.Fatalf("both pages present should load, got %q", problem)
	}
}

func TestScanOne_MissingEntryPageIsALoadProblem(t *testing.T) {
	root := t.TempDir()
	dir := writeConformPlugin(t, root, "entryless", viewEntryManifest("entryless"), map[string]string{"main.js": "export function activate() {}"})
	writeTestIcon(t, dir)
	svc := &PluginService{dir: root}
	if got := svc.scanOne("entryless").Error; got != `view "panel" entry "view.html" is missing` {
		t.Fatalf("unexpected load error: %q", got)
	}
}

func TestConformStandard_Rule21_EntryPageLoadsOnlyFolderFiles(t *testing.T) {
	remote := `<!doctype html><html><head><script src="https://cdn.example.com/lib.js"></script></head><body></body></html>`
	dir := newFixture(t, "remote-entry", viewEntryManifest("remote-entry"), map[string]string{
		"main.js": "export function activate() {}", "view.html": remote,
	})
	wantRule(t, dir, "standard rule 21")

	clean := newFixture(t, "local-entry", viewEntryManifest("local-entry"), map[string]string{
		"main.js": "export function activate() {}", "view.html": entryPage,
		"view.js": "", "view.css": "",
	})
	if problems := ConformDir(clean, ""); len(problems) != 0 {
		t.Fatalf("a folder-local entry page should conform, got %v", problems)
	}
}

func TestConformStandard_Rule21_SameDOMSurfaceWarns(t *testing.T) {
	manifest := validIconManifest("legacy-view", "Legacy view", `"contributes":{"views":[{"id":"panel","title":"Panel"}]}`)
	dir := newFixture(t, "legacy-view", manifest, map[string]string{"main.js": "export function activate() {}"})
	warnings := strings.Join(ConformStandardWarnings(dir), "\n")
	if !strings.Contains(warnings, "standard rule 21: view \"panel\" declares no entry page") {
		t.Fatalf("want the rule 21 warning, got %v", warnings)
	}
	if problems := ConformDir(dir, ""); len(problems) != 0 {
		t.Fatalf("the legacy form still conforms, got %v", problems)
	}
}

func TestConformStandard_Rule21_InlineScriptNeverRunsInAPage(t *testing.T) {
	inline := `<!doctype html><html><head></head><body><script>go()</script></body></html>`
	dir := newFixture(t, "inline-entry", viewEntryManifest("inline-entry"), map[string]string{
		"main.js": "export function activate() {}", "view.html": inline,
	})
	wantRule(t, dir, "an inline <script> never runs in a plugin page")

	handler := `<!doctype html><html><head></head><body><button onclick="go()">Go</button></body></html>`
	attr := newFixture(t, "handler-entry", viewEntryManifest("handler-entry"), map[string]string{
		"main.js": "export function activate() {}", "view.html": handler,
	})
	wantRule(t, attr, "an inline event attribute never runs in a plugin page")
}
