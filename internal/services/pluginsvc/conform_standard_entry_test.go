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

// The placement vocabulary (docs/goals/0357): omitted and "tab" both
// mean an ordinary work tab, "board-switcher" lists the view in the
// Atlas board's own switcher, and anything else is a load refusal.
func TestValidateViews_PlacementVocabulary(t *testing.T) {
	for _, placement := range []string{"", "tab", "board-switcher"} {
		if problem := validateViews([]ViewContribution{{ID: "panel", Title: "Panel", Entry: "view.html", Placement: placement}}); problem != "" {
			t.Fatalf("placement %q should validate, got %q", placement, problem)
		}
	}
	problem := validateViews([]ViewContribution{{ID: "panel", Title: "Panel", Entry: "view.html", Placement: "sidebar"}})
	want := `contributed view "panel" has an unknown placement "sidebar" (tab or board-switcher)`
	if problem != want {
		t.Fatalf("unknown placement: got %q, want %q", problem, want)
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

// A canvas object is the one surface family still allowed to skip an
// entry page (the "canvas-host" grant, docs/goals/0375 S1b): it warns
// under rule 21 but still conforms.
func TestConformStandard_Rule21_SameDOMCanvasObjectWarns(t *testing.T) {
	manifest := validIconManifest("legacy-face", "Legacy face", `"contributes":{"canvasObjects":[{"kind":"legacy"}]}`)
	dir := newFixture(t, "legacy-face", manifest, map[string]string{"main.js": "export function activate() {}"})
	warnings := strings.Join(ConformStandardWarnings(dir), "\n")
	if !strings.Contains(warnings, `standard rule 21: canvas object "legacy" declares no entry page`) {
		t.Fatalf("want the rule 21 warning, got %v", warnings)
	}
	if problems := ConformDir(dir, ""); len(problems) != 0 {
		t.Fatalf("the same-DOM canvas object still conforms, got %v", problems)
	}
}

// A view or capture with no entry page cannot activate framed at all
// (docs/goals/0375 S1b), so it is a hard refusal (rule 32) rather than
// rule 21's advisory warning -- passing and failing manifests.
func TestConformStandard_Rule32_ViewsAndCapturesNeedAnEntryPage(t *testing.T) {
	missingView := validIconManifest("no-entry-view", "No entry view", `"contributes":{"views":[{"id":"panel","title":"Panel"}]}`)
	dir := newFixture(t, "no-entry-view", missingView, map[string]string{"main.js": "export function activate() {}"})
	wantRule(t, dir, `standard rule 32: view "panel" needs an entry page; Mill runs it in a sandbox`)

	missingCapture := validIconManifest("no-entry-capture", "No entry capture", `"contributes":{"captures":[{"id":"jot","label":"Jot"}]}`)
	dirC := newFixture(t, "no-entry-capture", missingCapture, map[string]string{"main.js": "export function activate() {}"})
	wantRule(t, dirC, `standard rule 32: capture "jot" needs an entry page; Mill runs it in a sandbox`)

	dirOK := newFixture(t, "has-entry-view", viewEntryManifest("has-entry-view"), map[string]string{
		"main.js": "export function activate() {}", "view.html": entryPage, "view.js": "", "view.css": "",
	})
	if problems := ConformDir(dirOK, ""); len(problems) != 0 {
		t.Fatalf("a view with an entry page should conform, got %v", problems)
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
