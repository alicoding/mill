package pluginsvc

import (
	"errors"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/alicoding/mill/internal/domain/usererror"
)

func TestValidateDependencyShape(t *testing.T) {
	cases := []struct {
		name string
		deps []DependencyContribution
		want string
	}{
		{"empty", nil, ""},
		{"valid range", []DependencyContribution{{ID: "mill-alpha", Version: ">=1.0.0 <2.0.0"}}, ""},
		{"bad id", []DependencyContribution{{ID: "Mill Alpha", Version: "1.0.0"}}, "dependency id"},
		{"self dependency", []DependencyContribution{{ID: "mill-self", Version: "1.0.0"}}, "cannot depend on itself"},
		{"duplicate", []DependencyContribution{{ID: "mill-alpha", Version: "1.0.0"}, {ID: "mill-alpha", Version: "2.0.0"}}, "declared twice"},
		{"bad range", []DependencyContribution{{ID: "mill-alpha", Version: "not a range"}}, "is not a version range"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := validateDependencyShape("mill-self", c.deps)
			if c.want == "" && got != "" {
				t.Fatalf("got %q, want no problem", got)
			}
			if c.want != "" && !strings.Contains(got, c.want) {
				t.Fatalf("got %q, want it to contain %q", got, c.want)
			}
		})
	}
}

func TestValidateExportsShape(t *testing.T) {
	cases := []struct {
		name    string
		exports []string
		want    string
	}{
		{"empty", nil, ""},
		{"valid", []string{"greet", "_private", "$jq"}, ""},
		{"not an identifier", []string{"greet(x)"}, "must be a plain method name"},
		{"duplicate", []string{"greet", "greet"}, "declared twice"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := validateExportsShape(c.exports)
			if c.want == "" && got != "" {
				t.Fatalf("got %q, want no problem", got)
			}
			if c.want != "" && !strings.Contains(got, c.want) {
				t.Fatalf("got %q, want it to contain %q", got, c.want)
			}
		})
	}
}

func TestDependencyRefusals(t *testing.T) {
	installed := map[string]Manifest{
		"mill-alpha": {ID: "mill-alpha", Version: "1.0.0"},
	}
	cases := []struct {
		name string
		deps []DependencyContribution
		want int
	}{
		{"satisfied", []DependencyContribution{{ID: "mill-alpha", Version: ">=1.0.0"}}, 0},
		{"not installed", []DependencyContribution{{ID: "mill-missing", Version: "1.0.0"}}, 1},
		{"out of range", []DependencyContribution{{ID: "mill-alpha", Version: ">=2.0.0"}}, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := dependencyRefusals(c.deps, installed)
			if len(got) != c.want {
				t.Fatalf("refusals = %v, want %d", got, c.want)
			}
		})
	}
}

func TestDependencyRefusals_SentenceNamesTheNeed(t *testing.T) {
	got := dependencyRefusals([]DependencyContribution{{ID: "mill-alpha", Version: ">=2.0.0"}}, map[string]Manifest{"mill-alpha": {ID: "mill-alpha", Version: "1.0.0"}})
	want := "This extension needs mill-alpha >=2.0.0, which is not installed."
	if len(got) != 1 || got[0] != want {
		t.Fatalf("refusals = %v, want [%q]", got, want)
	}
}

func TestDependencyCycle_DetectsAMutualPair(t *testing.T) {
	installed := map[string]Manifest{
		"mill-beta": {ID: "mill-beta", Dependencies: []DependencyContribution{{ID: "mill-alpha", Version: "1.0.0"}}},
	}
	a, b, found := dependencyCycle("mill-alpha", []DependencyContribution{{ID: "mill-beta", Version: "1.0.0"}}, installed)
	if !found {
		t.Fatal("no cycle found, want one")
	}
	pairMatches := (a == "mill-alpha" && b == "mill-beta") || (a == "mill-beta" && b == "mill-alpha")
	if !pairMatches {
		t.Fatalf("cycle pair = (%s, %s), want mill-alpha/mill-beta", a, b)
	}
}

func TestDependencyCycle_NoCycleThroughAnUnrelatedChain(t *testing.T) {
	installed := map[string]Manifest{
		"mill-beta":  {ID: "mill-beta", Dependencies: []DependencyContribution{{ID: "mill-gamma", Version: "1.0.0"}}},
		"mill-gamma": {ID: "mill-gamma"},
	}
	_, _, found := dependencyCycle("mill-alpha", []DependencyContribution{{ID: "mill-beta", Version: "1.0.0"}}, installed)
	if found {
		t.Fatal("found a cycle where there is none")
	}
}

// TestInstallFromMarketplace_RefusesADependencyOutOfRange is design
// contract item 5's "a third fixture with a bad range refused at
// install", proved through the REAL install door (InstallFromMarketplace
// -> finishInstall -> stagedChecks), the same layer every other
// install-refusal test in this package proves at (policy_install_test.go).
func TestInstallFromMarketplace_RefusesADependencyOutOfRange(t *testing.T) {
	fsys := exampleFS("mill-alpha")
	fsys[exampleMarketplaceRoot+"/mill-beta/manifest.json"] = &fstest.MapFile{Data: []byte(
		`{"id":"mill-beta","name":"Example mill-beta","version":"1.0.0","author":"Mill","description":"An example.",` +
			`"dependencies":[{"id":"mill-alpha","version":">=2.0.0"}]}`)}
	fsys[exampleMarketplaceRoot+"/mill-beta/main.js"] = &fstest.MapFile{Data: []byte("export function activate() {}")}
	dir := t.TempDir()
	svc := newTestPluginService(t, dir, nil, "")
	svc.SetExampleMarketplace(fsys)
	if _, err := installMarketplaceForTest(t, svc, ReservedMarketplaceName, "mill-alpha"); err != nil {
		t.Fatalf("installing the dependency: %v", err)
	}
	_, err := installMarketplaceForTest(t, svc, ReservedMarketplaceName, "mill-beta")
	var ue *usererror.Error
	if !errors.As(err, &ue) || ue.Code != InstallRefusedCode {
		t.Fatalf("err = %v, want the install refusal", err)
	}
	want := "This extension needs mill-alpha >=2.0.0, which is not installed."
	if ue.Message != want {
		t.Fatalf("message = %q, want %q", ue.Message, want)
	}
}

// TestInstallFromMarketplace_RefusesAMutualDependencyCycle proves the
// second install-time refusal: a dependency graph that would close a
// cycle is refused with the pair that closes it.
func TestInstallFromMarketplace_RefusesAMutualDependencyCycle(t *testing.T) {
	fsys := exampleFS("mill-alpha")
	fsys[exampleMarketplaceRoot+"/mill-alpha/manifest.json"] = &fstest.MapFile{Data: []byte(
		`{"id":"mill-alpha","name":"Example mill-alpha","version":"1.0.0","author":"Mill","description":"An example."}`)}
	fsys[exampleMarketplaceRoot+"/mill-beta/manifest.json"] = &fstest.MapFile{Data: []byte(
		`{"id":"mill-beta","name":"Example mill-beta","version":"1.0.0","author":"Mill","description":"An example.",` +
			`"dependencies":[{"id":"mill-alpha","version":">=1.0.0"}]}`)}
	fsys[exampleMarketplaceRoot+"/mill-beta/main.js"] = &fstest.MapFile{Data: []byte("export function activate() {}")}
	dir := t.TempDir()
	svc := newTestPluginService(t, dir, nil, "")
	svc.SetExampleMarketplace(fsys)
	if _, err := installMarketplaceForTest(t, svc, ReservedMarketplaceName, "mill-alpha"); err != nil {
		t.Fatalf("installing mill-alpha: %v", err)
	}
	if _, err := installMarketplaceForTest(t, svc, ReservedMarketplaceName, "mill-beta"); err != nil {
		t.Fatalf("installing mill-beta: %v", err)
	}
	// mill-alpha now declares a dependency on mill-beta, closing a
	// cycle with the already-installed mill-beta -> mill-alpha edge.
	fsys[exampleMarketplaceRoot+"/mill-alpha/manifest.json"] = &fstest.MapFile{Data: []byte(
		`{"id":"mill-alpha","name":"Example mill-alpha","version":"1.0.0","author":"Mill","description":"An example.",` +
			`"dependencies":[{"id":"mill-beta","version":">=1.0.0"}]}`)}
	_, err := installMarketplaceForTest(t, svc, ReservedMarketplaceName, "mill-alpha")
	var ue *usererror.Error
	if !errors.As(err, &ue) || ue.Code != InstallRefusedCode || !strings.Contains(ue.Message, "depend on each other") {
		t.Fatalf("err = %v, want the cycle refusal", err)
	}
}
