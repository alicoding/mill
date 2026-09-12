package pluginsvc

import (
	"os"
	"reflect"
	"sort"
	"testing"
)

// mill-bookmark's own migration (docs/goals/0380 S2) is the concrete
// proof NeedsCanvasHost's new rule is meant to cover: its one canvas
// object names an entry page and declares no tool at all, which the
// OLD rule (tool AND entry) would still have gated. Reads the real
// shipped manifest rather than a synthetic fixture, so a future edit
// to that file that drops `entry` fails HERE, not only in the trust
// UI a person would have to notice by eye.
func TestNeedsCanvasHost_MillBookmarkLeavesTheGrant(t *testing.T) {
	raw, err := os.ReadFile("../../../examples/plugins/mill-bookmark/manifest.json") // #nosec G304 -- a fixed repo-relative path, never external input
	if err != nil {
		t.Fatal(err)
	}
	manifest, problem := parseManifest(raw)
	if problem != "" {
		t.Fatal(problem)
	}
	if NeedsCanvasHost(manifest) {
		t.Fatal("mill-bookmark still needs canvas-host: its bookmark kind should declare an entry page now")
	}
}

// widenedFrom is the pure MV3-style re-consent rule (docs/goals/0375
// S2): each element kind widens on its own, a narrowed or unchanged
// set never does, and an empty grant (never allowed) is handled by the
// caller before this runs.
func TestWidenedFrom_EachElementKindWidens(t *testing.T) {
	base := PluginGrant{Capabilities: []string{"open-url"}, Hosts: []string{"a.test"}, Kinds: []string{"views"}}
	tests := []struct {
		name    string
		granted PluginGrant
		current PluginGrant
		widened bool
	}{
		{"identical sets never widen", base, base, false},
		{"a new capability widens", base, PluginGrant{Capabilities: []string{"open-url", "fetch"}, Hosts: base.Hosts, Kinds: base.Kinds}, true},
		{"a new host widens", base, PluginGrant{Capabilities: base.Capabilities, Hosts: []string{"a.test", "b.test"}, Kinds: base.Kinds}, true},
		{"any-host turning on widens", base, PluginGrant{Capabilities: base.Capabilities, Hosts: base.Hosts, Kinds: base.Kinds, AnyHost: true}, true},
		{"a new contribution kind widens", base, PluginGrant{Capabilities: base.Capabilities, Hosts: base.Hosts, Kinds: []string{"views", "steps"}}, true},
		{"using secrets for the first time widens", base, PluginGrant{Capabilities: base.Capabilities, Hosts: base.Hosts, Kinds: base.Kinds, UsesSecrets: true}, true},
		{"canvas-host turning on widens", base, PluginGrant{Capabilities: base.Capabilities, Hosts: base.Hosts, Kinds: base.Kinds, CanvasHost: true}, true},
		{"dropping a capability never re-gates", base, PluginGrant{Hosts: base.Hosts, Kinds: base.Kinds}, false},
		{"dropping a host never re-gates", base, PluginGrant{Capabilities: base.Capabilities, Kinds: base.Kinds}, false},
		{"dropping a kind never re-gates", base, PluginGrant{Capabilities: base.Capabilities, Hosts: base.Hosts}, false},
		{"an unrelated no-op edit never re-gates", base, base, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			diff, widened := widenedFrom(tc.granted, tc.current)
			if widened != tc.widened {
				t.Fatalf("widened = %v, want %v (diff %+v)", widened, tc.widened, diff)
			}
		})
	}
}

// The diff carries only what is NEW, never what narrowed or stayed.
func TestWidenedFrom_DiffCarriesOnlyNewElements(t *testing.T) {
	granted := PluginGrant{Capabilities: []string{"open-url"}, Hosts: []string{"a.test"}}
	current := PluginGrant{Capabilities: []string{"open-url", "fetch"}, Hosts: []string{"b.test"}}
	diff, widened := widenedFrom(granted, current)
	if !widened {
		t.Fatal("expected widened")
	}
	if len(diff.Capabilities) != 1 || diff.Capabilities[0] != "fetch" {
		t.Fatalf("diff.Capabilities = %v, want just [fetch]", diff.Capabilities)
	}
	if len(diff.Hosts) != 1 || diff.Hosts[0] != "b.test" {
		t.Fatalf("diff.Hosts = %v, want just [b.test]", diff.Hosts)
	}
}

func TestNetworkMethodGrantPreservesExactRuntimeAuthority(t *testing.T) {
	grant := func(entries ...NetworkContribution) PluginGrant {
		return currentGrant(Manifest{Contributes: ManifestContributes{Network: entries}})
	}
	for _, test := range []struct {
		name        string
		granted     PluginGrant
		current     PluginGrant
		wantWidened bool
		wantMethods map[string][]string
	}{
		{
			name: "same host GET to POST", granted: grant(NetworkContribution{Host: "api.example.test"}),
			current:     grant(NetworkContribution{Host: "api.example.test", Methods: []string{"GET", "POST"}}),
			wantWidened: true, wantMethods: map[string][]string{"api.example.test": {"POST"}},
		},
		{
			name: "POST removal narrows", granted: grant(NetworkContribution{Host: "api.example.test", Methods: []string{"GET", "POST"}}),
			current: grant(NetworkContribution{Host: "api.example.test"}),
		},
		{
			name: "empty methods equal GET", granted: grant(NetworkContribution{Host: "api.example.test"}),
			current: grant(NetworkContribution{Host: "api.example.test", Methods: []string{"get"}}),
		},
		{
			name: "duplicates union deterministically", granted: grant(NetworkContribution{Host: "api.example.test", Methods: []string{"GET"}}),
			current: grant(
				NetworkContribution{Host: "api.example.test", Methods: []string{"post", "GET"}},
				NetworkContribution{Host: "api.example.test", Methods: []string{"POST", "delete"}},
			),
			wantWidened: true, wantMethods: map[string][]string{"api.example.test": {"DELETE", "POST"}},
		},
		{
			name: "one host cannot authorize another", granted: grant(NetworkContribution{Host: "one.example.test", Methods: []string{"POST"}}),
			current:     grant(NetworkContribution{Host: "two.example.test", Methods: []string{"POST"}}),
			wantWidened: true, wantMethods: map[string][]string{"two.example.test": {"POST"}},
		},
		{
			name: "wildcard does not cover explicit host", granted: grant(NetworkContribution{Host: "*", Methods: []string{"POST"}}),
			current:     grant(NetworkContribution{Host: "api.example.test", Methods: []string{"POST"}}),
			wantWidened: true, wantMethods: map[string][]string{"api.example.test": {"POST"}},
		},
		{
			name: "explicit host does not cover wildcard", granted: grant(NetworkContribution{Host: "api.example.test", Methods: []string{"POST"}}),
			current:     grant(NetworkContribution{Host: "*", Methods: []string{"POST"}}),
			wantWidened: true, wantMethods: map[string][]string{"*": {"POST"}},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			diff, widened := widenedFrom(test.granted, test.current)
			if widened != test.wantWidened {
				t.Fatalf("widened = %v, want %v (diff %+v)", widened, test.wantWidened, diff)
			}
			if !reflect.DeepEqual(diff.NetworkMethods, test.wantMethods) {
				t.Fatalf("network method diff = %#v, want %#v", diff.NetworkMethods, test.wantMethods)
			}
		})
	}
}

func TestHistoricalNetworkGrantCannotQualifyBulkUpdate(t *testing.T) {
	service, source := installedReplacementFixture(t)
	installed := service.scanOneWithoutApproval("replace-me")
	record, ok := ReadInstallRecord(installed.Dir)
	if !ok {
		t.Fatal("installed fixture has no receipt")
	}
	service.WireAudit(fixedGrantTrust{approval: PluginApproval{
		Allowed: []string{"replace-me"},
		Locks:   map[string]PluginApprovalLock{"replace-me": {Hash: installed.CodeHash, Grant: PluginGrant{NetworkGrantVersion: 0}}},
	}}, nil)
	manifest, err := readStagedManifest(source)
	if err != nil {
		t.Fatal(err)
	}
	record.Tier = TierHashPinned
	artifact := preparedArtifact{update: true, installedPresent: true, record: record}
	if !service.requiresReviewLocked(artifact, manifest) {
		t.Fatal("historical network grant qualified an update for automatic bulk installation")
	}
}

type fixedGrantTrust struct{ approval PluginApproval }

func (f fixedGrantTrust) Enabled(string) bool               { return true }
func (f fixedGrantTrust) Allowlist() []string               { return nil }
func (f fixedGrantTrust) Approval() (PluginApproval, error) { return f.approval, nil }

// grantTrust is a PluginTrustReader test double whose approval snapshot
// carries a fixed grant table.
type grantTrust struct{ grants map[string]PluginGrant }

func (g grantTrust) Enabled(string) bool { return true }
func (g grantTrust) Allowlist() []string { return nil }
func (g grantTrust) Approval() (PluginApproval, error) {
	approval := PluginApproval{Locks: map[string]PluginApprovalLock{}}
	for id, grant := range g.grants {
		approval.Allowed = append(approval.Allowed, id)
		approval.Locks[id] = PluginApprovalLock{Hash: "test-hash", Grant: grant}
	}
	sort.Strings(approval.Allowed)
	return approval, nil
}

// scanOne stamps PluginInfo.Widened from the wired trust reader: a
// plugin never granted stays nil (nothing to compare), a widened
// manifest carries the diff, and a built-in never widens.
func TestScanOne_StampsWidenedFromTrustReader(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "mill-a", `{"id":"mill-a","name":"A","version":"1.0.0","capabilities":["open-url","fetch"]}`, nil)
	writePlugin(t, root, "mill-b", `{"id":"mill-b","name":"B","version":"1.0.0","capabilities":["open-url"]}`, nil)
	writePlugin(t, root, "mill-c", `{"id":"mill-c","name":"C","version":"1.0.0","capabilities":["open-url"]}`, nil)

	p := New(root, nil, "")
	p.WireAudit(grantTrust{grants: map[string]PluginGrant{
		// mill-a: granted only open-url, manifest now also declares
		// fetch -- widened.
		"mill-a": {Capabilities: []string{"open-url"}},
		// mill-b: granted open-url, manifest still only declares
		// open-url -- unchanged, no widen.
		"mill-b": {Capabilities: []string{"open-url"}},
		// mill-c is never granted (absent from the map) -- nothing to
		// compare, no widen.
	}}, nil)

	a := p.scanOne("mill-a")
	if a.Widened == nil {
		t.Fatal("mill-a: expected Widened to be set")
	}
	if len(a.Widened.Capabilities) != 1 || a.Widened.Capabilities[0] != "fetch" {
		t.Fatalf("mill-a widened diff = %+v", a.Widened)
	}
	if !p.Widened("mill-a") {
		t.Fatal("Widened(mill-a) = false, want true")
	}

	b := p.scanOne("mill-b")
	if b.Widened != nil {
		t.Fatalf("mill-b: expected no widen, got %+v", b.Widened)
	}
	if p.Widened("mill-b") {
		t.Fatal("Widened(mill-b) = true, want false")
	}

	c := p.scanOne("mill-c")
	if c.Widened != nil {
		t.Fatalf("mill-c: never granted, expected no widen, got %+v", c.Widened)
	}

	// A built-in never widens -- it carries no grant to widen.
	if p.Widened("mill-drawing") {
		t.Fatal("a built-in must never widen")
	}
}
