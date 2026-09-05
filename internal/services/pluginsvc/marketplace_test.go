package pluginsvc

import (
	"strings"
	"testing"
)

func TestParseIndex_AcceptsAWellFormedIndex(t *testing.T) {
	idx, err := ParseIndex([]byte(`{
		"name": "acme",
		"owner": { "name": "Acme", "url": "https://example.test" },
		"plugins": [
			{ "id": "acme-notes", "name": "Notes", "version": "1.0.0", "source": { "kind": "path", "path": "plugins/acme-notes" } },
			{ "id": "acme-web", "name": "Web", "version": "2.1.0", "source": { "kind": "archive", "url": "https://example.test/web.zip", "sha256": "abc" } }
		]
	}`))
	if err != nil {
		t.Fatalf("ParseIndex() = %v, want nil error", err)
	}
	if idx.Name != "acme" || len(idx.Plugins) != 2 {
		t.Fatalf("index = %+v, want name acme with 2 plugins", idx)
	}
	if idx.Owner.Name != "Acme" {
		t.Errorf("owner = %q, want Acme", idx.Owner.Name)
	}
}

// The reserved name is what keeps a third-party index from
// impersonating the extensions Mill itself ships.
func TestParseIndex_RefusesTheReservedName(t *testing.T) {
	_, err := ParseIndex([]byte(`{"name":"mill","plugins":[]}`))
	if err == nil || !strings.Contains(err.Error(), "reserved") {
		t.Fatalf("err = %v, want a reserved-name refusal", err)
	}
}

func TestParseIndex_RefusesANameOutsideTheSlugShape(t *testing.T) {
	for _, name := range []string{"", "Acme Store", "acme/store", "-acme"} {
		if _, err := ParseIndex([]byte(`{"name":"` + name + `","plugins":[]}`)); err == nil {
			t.Errorf("ParseIndex(name=%q) = nil error, want a refusal", name)
		}
	}
}

// Two entries with one id would make "install acme-notes" undefined.
func TestParseIndex_RefusesDuplicatePluginIDs(t *testing.T) {
	_, err := ParseIndex([]byte(`{"name":"acme","plugins":[
		{"id":"acme-notes","source":{"kind":"path","path":"a"}},
		{"id":"acme-notes","source":{"kind":"path","path":"b"}}
	]}`))
	if err == nil || !strings.Contains(err.Error(), "twice") {
		t.Fatalf("err = %v, want a duplicate-id refusal", err)
	}
}

func TestParseIndex_RefusesAPathSourceThatEscapesTheMarketplace(t *testing.T) {
	_, err := ParseIndex([]byte(`{"name":"acme","plugins":[
		{"id":"acme-notes","source":{"kind":"path","path":"../../etc"}}
	]}`))
	if err == nil {
		t.Fatal("ParseIndex() = nil error, want a traversal refusal")
	}
}

func TestParseIndex_RefusesAnUnknownSourceKind(t *testing.T) {
	_, err := ParseIndex([]byte(`{"name":"acme","plugins":[{"id":"acme-notes","source":{"kind":"ftp"}}]}`))
	if err == nil || !strings.Contains(err.Error(), "unknown source kind") {
		t.Fatalf("err = %v, want an unknown-kind refusal", err)
	}
}

func TestClassifySource_ReadsEachShapeTheFieldAccepts(t *testing.T) {
	cases := []struct {
		in      string
		kind    string
		locator string
		ref     string
	}{
		{"acme/store", "github", "acme/store", ""},
		{"acme/store@v2", "github", "acme/store", "v2"},
		{"https://example.test/.mill/marketplace.json", "url", "https://example.test/.mill/marketplace.json", ""},
		{"https://github.com/acme/store.git", "git", "https://github.com/acme/store.git", ""},
		{"git@github.com:acme/store.git", "git", "git@github.com:acme/store.git", ""},
		{"/Users/someone/store", "path", "/Users/someone/store", ""},
	}
	for _, c := range cases {
		got, err := ClassifySource(c.in)
		if err != nil {
			t.Errorf("ClassifySource(%q) = %v", c.in, err)
			continue
		}
		if got.Kind != c.kind || got.Locator != c.locator || got.Ref != c.ref {
			t.Errorf("ClassifySource(%q) = %+v, want kind %q locator %q ref %q", c.in, got, c.kind, c.locator, c.ref)
		}
	}
}

func TestClassifySource_RefusesSomethingThatIsNoneOfThem(t *testing.T) {
	for _, in := range []string{"", "  ", "just some words"} {
		if _, err := ClassifySource(in); err == nil {
			t.Errorf("ClassifySource(%q) = nil error, want a refusal", in)
		}
	}
}

// The one locator rule an install depends on: owner/repo[@ref] has to
// resolve to the raw index address, with HEAD standing in for an
// unpinned source.
func TestIndexURL_ResolvesARepoToItsRawIndexAddress(t *testing.T) {
	pinned, err := IndexURL(MarketplaceSource{Kind: "github", Locator: "acme/store", Ref: "v2"})
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://raw.githubusercontent.com/acme/store/v2/.mill/marketplace.json"; pinned != want {
		t.Errorf("IndexURL(pinned) = %q, want %q", pinned, want)
	}
	unpinned, err := IndexURL(MarketplaceSource{Kind: "github", Locator: "acme/store"})
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://raw.githubusercontent.com/acme/store/HEAD/.mill/marketplace.json"; unpinned != want {
		t.Errorf("IndexURL(unpinned) = %q, want %q", unpinned, want)
	}
}

func TestIndexURL_ResolvesAGitHubRemoteAndRefusesAnyOtherHost(t *testing.T) {
	got, err := IndexURL(MarketplaceSource{Kind: "git", Locator: "git@github.com:acme/store.git"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got, "https://raw.githubusercontent.com/acme/store/HEAD/") {
		t.Errorf("IndexURL(ssh remote) = %q", got)
	}
	if _, err := IndexURL(MarketplaceSource{Kind: "git", Locator: "https://gitlab.test/acme/store.git"}); err == nil {
		t.Error("IndexURL(non-GitHub remote) = nil error, want a refusal")
	}
}

func TestBranchArchiveURL_FallsBackToHEAD(t *testing.T) {
	if got := BranchArchiveURL("acme/store", ""); got != "https://codeload.github.com/acme/store/zip/HEAD" {
		t.Errorf("BranchArchiveURL() = %q", got)
	}
}

func TestReleaseAssetName_FollowsTheStandardsNaming(t *testing.T) {
	if got := ReleaseAssetName("acme-notes", "v1.2.0"); got != "acme-notes-1.2.0.zip" {
		t.Errorf("ReleaseAssetName() = %q, want acme-notes-1.2.0.zip", got)
	}
}
