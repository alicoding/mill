package pluginsvc

import (
	"fmt"
	"reflect"
	"strings"
	"time"
)

// The plugin API maturity ledger (goal 0348) -- the converged shape
// behind Kubernetes' alpha/beta/GA gate and OpenSSF Scorecard --
// a named level per surface, a table regenerated from repo facts on
// every build, and promotion left to a human decision the automation
// only flags. Every function here is read-only: it never mutates a
// plugin, a manifest, or Mill's own behavior -- the ledger only reads
// facts already on disk.
//
// Families() reflects ManifestContributes' own json tags (never a
// hand-copied list), so a new contribution family appears in the
// ledger the moment it lands in the struct, with no second edit here.
//
// FamilyStability is the only place a family's level changes, and only
// through a decision recorded in an architecture record (ADR-0047 set
// the first three; ADR-0048 the settings/network secret-handling
// half) -- never by this file noticing evidence is complete. A family
// absent from the map is experimental by construction: silence means
// "not yet promoted", never "forgotten".
//
// Evidence's per-family rules -- the exact function/file this ledger
// treats as proof, so a promotion argument can be checked against real
// code instead of a claim:
//
//	family        | conformance func (pluginsvc/*.go, conformStandard's own pass)
//	--------------|----------------------------------------------------
//	settings      | conformSettingDescriptions
//	commands      | conformCommandNamespace
//	themes        | conformThemes (themes.go -- called from conformStandard,
//	              | same build-time pass as the other two; not a conform*.go
//	              | file despite the name, see maturity_evidence.go)
//	(no entry)    | no conformance-pass function exists yet for this family
//
//	family        | generated SDK type (userdocs/reference/plugin-api/**)
//	--------------|----------------------------------------------------
//	canvasObjects | CanvasObjectDecl
//	captures      | PluginCaptureDecl
//	views         | PluginViewDecl
//	commands      | PluginCommandDecl
//	themes        | PluginThemeDecl
//	settings      | PluginSettingsAPI
//	network       | PluginFetchInit
//	steps, tools  | no entry -- declared in the manifest only, no runtime
//	              | SDK type of their own (steps.js/tools call existing
//	              | commands/steps through the manifest, not a typed API)
//
//	family        | MCP reachability (0324's plugin-tool bridge)
//	--------------|----------------------------------------------------
//	settings      | n/a -- declarative, nothing to call
//	network       | n/a -- declarative, nothing to call
//	themes        | n/a -- declarative, nothing to call
//	commands      | yes -- a tool's run.kind == "command" targets one
//	steps         | yes -- a tool's run.kind == "step" targets one
//	tools         | yes -- contributes.tools IS the MCP declaration surface
//	canvasObjects | yes -- goal 0324's list_plugins reports each plugin's
//	              | contributed canvas-object kinds (mcpsvc's
//	              | millmcpservice_plugins.go), and a canvas object is
//	              | file-backed content: the generic, ungated
//	              | atlas_read_board_object(s)/atlas_create_board_object
//	              | tools (mcpsvc's millmcpservice_atlas_boardobjects.go,
//	              | millmcpservice_atlas_createobject.go) already read
//	              | and write it, the two-plane boundary's content-plane
//	              | door (adopt-converged-patterns.md) -- never a
//	              | per-kind declared tool, but reachable all the same
//	captures      | n/a -- a floating capture window, a human-authoring
//	              | surface with no content-plane file of its own to
//	              | hand an agent; declarative for MCP purposes
//	views         | n/a -- a work tab the plugin renders, the same
//	              | human-authoring-only shape as captures; declarative
//	              | for MCP purposes
//	(new family)  | no, until a run.kind or an n/a decision names it
//
//	family        | e2e evidence (goal 0348 follow-up: the tightened rule)
//	--------------|----------------------------------------------------
//	              | Proven by ANY of: a spec file named
//	              | runtime-plugin-<family-or-kebab-family>*.spec.ts; any
//	              | frontend/e2e/*.spec.ts containing the family's own
//	              | SDK registration call (registerCanvasObject,
//	              | registerCommand, registerView, registerCapture) or
//	              | the literal text contributes.<family>; or a fixture
//	              | plugin under frontend/e2e/fixtures/**/manifest.json
//	              | declaring a non-empty contributes.<family>. Never a
//	              | bare whole-word match on the family name -- the
//	              | prior rule matched "themes" and "tools" inside
//	              | unrelated prose (a dark-mode comment, a JSON field
//	              | named "contributions") with no plugin code involved.
//
//	family        | canonical docs page (userdocs/reference/)
//	--------------|----------------------------------------------------
//	canvasObjects | extending-the-canvas.md
//	steps         | steps.md
//	captures      | install-a-plugin.md
//	settings      | settings.md
//	network       | install-a-plugin.md
//	views         | install-a-plugin.md
//	commands      | commands.md
//	themes        | plugin-theming.md
//	tools         | install-a-plugin.md
//	(new family)  | no entry -- Docs evidence still searches every
//	              | userdocs/reference/*.md for the family key; a
//	              | missing canonical-page entry only affects Currency
//	              | (DocsChangedAt stays zero until one is added here)

// Stability is one family's declared maturity level. Promotion or
// deprecation moves a family between these levels ONLY through a
// decision recorded in an architecture record (ADR-0047, ADR-0048) --
// never by editing FamilyStability because GatherEvidence happens to
// report every cell true that day.
type Stability string

const (
	StabilityExperimental Stability = "experimental"
	StabilityStable       Stability = "stable"
	StabilityDeprecated   Stability = "deprecated"
)

// FamilyStability is the closed, hand-maintained set of promotions.
// Every family not listed here is experimental.
var FamilyStability = map[string]Stability{
	"settings": StabilityStable,
	"commands": StabilityStable,
	"themes":   StabilityStable,
}

// LevelOf returns family's declared stability, defaulting to
// experimental for anything FamilyStability does not name.
func LevelOf(family string) Stability {
	if s, ok := FamilyStability[family]; ok {
		return s
	}
	return StabilityExperimental
}

// Families lists every contribution family in ManifestContributes'
// own struct order, read from its json tags by reflection -- adding a
// field to that struct is the only edit a new family needs; this list
// follows without a second change.
func Families() []string {
	t := reflect.TypeOf(ManifestContributes{})
	out := make([]string, 0, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		tag := t.Field(i).Tag.Get("json")
		name := strings.Split(tag, ",")[0]
		if name == "" || name == "-" {
			continue
		}
		out = append(out, name)
	}
	return out
}

// familyFieldName answers ManifestContributes' own Go field name for
// a family's json tag (e.g. "canvasObjects" -> "CanvasObjects"), the
// join between the reflected family list and the field references
// Currency's source-path search greps for.
func familyFieldName(family string) string {
	t := reflect.TypeOf(ManifestContributes{})
	for i := 0; i < t.NumField(); i++ {
		tag := strings.Split(t.Field(i).Tag.Get("json"), ",")[0]
		if tag == family {
			return t.Field(i).Name
		}
	}
	return ""
}

// Evidence is one family's readiness snapshot, every cell a fact read
// off the repo -- never a claim. MCP is "yes"/"no"/"n/a" rather than a
// bool because a purely declarative family (settings, network,
// themes) has nothing an agent calls; forcing it to false would read
// as a gap instead of the family's own shape.
type Evidence struct {
	Conformance bool
	Example     bool
	E2E         bool
	Docs        bool
	SDKTypes    bool
	MCP         string
}

func (e Evidence) complete() bool {
	return e.Conformance && e.Example && e.E2E && e.Docs && e.SDKTypes && e.MCP != "no"
}

// Currency is one family's docs-vs-code staleness signal: the last
// commit to touch its own source against the last commit to touch its
// canonical docs page. A family with no canonical docs page (a new
// family before docsPageByFamily names one) has a zero DocsChangedAt,
// and DaysBehind falls back to days since the code itself last
// changed -- there is no docs date to diff against yet.
type Currency struct {
	CodeChangedAt time.Time
	DocsChangedAt time.Time
	DaysBehind    int
}

func daysBehind(code, docs time.Time) int {
	if docs.IsZero() {
		if code.IsZero() {
			return 0
		}
		return int(time.Since(code).Hours() / 24)
	}
	d := int(code.Sub(docs).Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
}

// Flags names the two states worth a human's attention: an
// experimental family whose evidence is now complete (a promotion
// argument, not a promotion), and a stable family that has lost
// evidence it once had (a regression the ledger refuses to stay quiet
// about -- TestMaturity_StableFamiliesKeepTheirEvidence is the build
// gate this flag mirrors).
func Flags(level Stability, e Evidence) []string {
	var flags []string
	switch level {
	case StabilityExperimental:
		if e.complete() {
			flags = append(flags, "ready-to-promote")
		}
	case StabilityStable:
		if !e.complete() {
			flags = append(flags, "regressed")
		}
	}
	return flags
}

// Row is one family's full ledger entry.
type Row struct {
	Family   string
	Level    Stability
	Evidence Evidence
	Currency Currency
	Flags    []string
}

// Ledger is the whole generated report.
type Ledger struct {
	GeneratedAt time.Time
	Headline    string
	Rows        []Row
}

func headline(rows []Row) string {
	total := len(rows)
	stable := 0
	ready := 0
	regressed := 0
	for _, r := range rows {
		if r.Level == StabilityStable {
			stable++
		}
		for _, f := range r.Flags {
			switch f {
			case "ready-to-promote":
				ready++
			case "regressed":
				regressed++
			}
		}
	}
	return fmt.Sprintf("%d of %d contribution families are stable; %d ready to promote; %d regressed.", stable, total, ready, regressed)
}

// Report reads repoRoot and builds the full ledger: one row per
// family, in ManifestContributes' own struct order.
func Report(repoRoot string) Ledger {
	families := Families()
	rows := make([]Row, 0, len(families))
	evidence := GatherEvidence(repoRoot)
	for _, family := range families {
		level := LevelOf(family)
		e := evidence[family]
		rows = append(rows, Row{
			Family:   family,
			Level:    level,
			Evidence: e,
			Currency: gatherCurrency(repoRoot, family),
			Flags:    Flags(level, e),
		})
	}
	return Ledger{
		GeneratedAt: time.Now(),
		Headline:    headline(rows),
		Rows:        rows,
	}
}
