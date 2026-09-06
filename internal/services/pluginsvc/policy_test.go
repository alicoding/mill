package pluginsvc

import (
	"crypto/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aead.dev/minisign"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// The policy file (docs/goals/0349 S6): what parses, what fails
// closed, and which sentence each refusal answers with.

const testKeyText = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3"

func writePolicy(t *testing.T, body string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "plugin-policy.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(PolicyPathEnv, path)
}

func TestParsePolicy_AcceptsEveryKey(t *testing.T) {
	p, err := ParsePolicy([]byte(`{
		"version": 1, "managedBy": "Example Bank",
		"allow": [{"id": "acme-notes", "versions": "^1.2"}, {"publisherKey": "` + testKeyText + `"}],
		"block": [{"id": "acme-old", "versions": ">=1 <2"}],
		"requiredTier": "verified",
		"blockedCapabilities": ["fetch", "write-content"],
		"allowedSources": ["bank-market", "https://git.example.test/mill"]
	}`))
	if err != nil {
		t.Fatalf("ParsePolicy() = %v", err)
	}
	if p.ManagedBy != "Example Bank" || len(p.Allow) != 2 || len(p.Block) != 1 || p.RequiredTier != TierVerified {
		t.Fatalf("policy = %+v", p)
	}
	if len(p.BlockedCapabilities) != 2 || len(p.AllowedSources) != 2 {
		t.Fatalf("policy lists = %+v", p)
	}
}

func TestParsePolicy_DefaultsRequiredTierToAny(t *testing.T) {
	p, err := ParsePolicy([]byte(`{"version": 1, "managedBy": "Org"}`))
	if err != nil {
		t.Fatal(err)
	}
	if p.RequiredTier != TierAny {
		t.Fatalf("requiredTier = %q, want %q", p.RequiredTier, TierAny)
	}
}

func TestParsePolicy_RefusesEachMalformedKey(t *testing.T) {
	cases := map[string]string{
		"not json":             `{`,
		"wrong version":        `{"version": 2, "managedBy": "Org"}`,
		"no managedBy":         `{"version": 1}`,
		"unknown key":          `{"version": 1, "managedBy": "Org", "allowAll": true}`,
		"empty rule":           `{"version": 1, "managedBy": "Org", "allow": [{}]}`,
		"bad id":               `{"version": 1, "managedBy": "Org", "block": [{"id": "Not Valid"}]}`,
		"bad key":              `{"version": 1, "managedBy": "Org", "allow": [{"publisherKey": "nope"}]}`,
		"bad range":            `{"version": 1, "managedBy": "Org", "allow": [{"id": "a", "versions": "banana"}]}`,
		"unknown tier":         `{"version": 1, "managedBy": "Org", "requiredTier": "gold"}`,
		"unknown capability":   `{"version": 1, "managedBy": "Org", "blockedCapabilities": ["teleport"]}`,
		"empty allowed source": `{"version": 1, "managedBy": "Org", "allowedSources": [""]}`,
	}
	for name, body := range cases {
		if _, err := ParsePolicy([]byte(body)); err == nil {
			t.Errorf("%s: parsed, want a refusal", name)
		}
	}
}

func TestLoadPolicy_MissingFileIsUnmanaged(t *testing.T) {
	t.Setenv(PolicyPathEnv, filepath.Join(t.TempDir(), "absent.json"))
	st := LoadPolicy()
	if st.Present || st.Error != "" {
		t.Fatalf("state = %+v, want unmanaged", st)
	}
}

// A present file that cannot be read closes the door with the one
// sentence, never opens it.
func TestLoadPolicy_MalformedFileFailsClosed(t *testing.T) {
	writePolicy(t, `{"version": 1`)
	st := LoadPolicy()
	if !st.Present || st.Error != ErrPolicyUnreadable.Message {
		t.Fatalf("state = %+v, want the fail-closed sentence", st)
	}
}

func subject(id, version, tier string, caps ...string) PolicySubject {
	return PolicySubject{ID: id, Version: version, Tier: tier, Capabilities: caps}
}

func TestPolicyRefusal_BlockWinsOverAllow(t *testing.T) {
	p := Policy{Allow: []PolicyRule{{ID: "acme-notes"}}, Block: []PolicyRule{{ID: "acme-notes"}}, RequiredTier: TierAny}
	if got := p.Refusal(subject("acme-notes", "1.0.0", TierVerified)); got != "Your organisation blocks this extension." {
		t.Fatalf("refusal = %q", got)
	}
}

func TestPolicyRefusal_AllowListIsExclusive(t *testing.T) {
	p := Policy{Allow: []PolicyRule{{ID: "acme-notes"}}, RequiredTier: TierAny}
	if got := p.Refusal(subject("acme-notes", "1.0.0", TierDev)); got != "" {
		t.Fatalf("listed plugin refused: %q", got)
	}
	if got := p.Refusal(subject("other", "1.0.0", TierVerified)); got != "Your organisation allows only the extensions on its list." {
		t.Fatalf("unlisted plugin: %q", got)
	}
}

func TestPolicyRefusal_VersionRanges(t *testing.T) {
	p := Policy{Block: []PolicyRule{{ID: "acme-notes", Versions: ">=1 <2"}}, RequiredTier: TierAny}
	if got := p.Refusal(subject("acme-notes", "1.4.0", TierVerified)); got != "Your organisation blocks version 1.4.0 of this extension." {
		t.Fatalf("in range: %q", got)
	}
	if got := p.Refusal(subject("acme-notes", "2.0.0", TierVerified)); got != "" {
		t.Fatalf("out of range refused: %q", got)
	}
	// A version that does not parse matches a block rule (closed) and
	// never an allow rule (also closed).
	if got := p.Refusal(subject("acme-notes", "latest", TierVerified)); got == "" {
		t.Fatal("unparseable version slipped past a block range")
	}
	allow := Policy{Allow: []PolicyRule{{ID: "acme-notes", Versions: "^1.2"}}, RequiredTier: TierAny}
	if got := allow.Refusal(subject("acme-notes", "latest", TierVerified)); got == "" {
		t.Fatal("unparseable version slipped past an allow range")
	}
	if got := allow.Refusal(subject("acme-notes", "1.9.3", TierVerified)); got != "" {
		t.Fatalf("caret range refused 1.9.3: %q", got)
	}
}

func TestPolicyRefusal_PublisherKey(t *testing.T) {
	var pk minisign.PublicKey
	if err := pk.UnmarshalText([]byte(testKeyText)); err != nil {
		t.Fatal(err)
	}
	p := Policy{Allow: []PolicyRule{{PublisherKey: testKeyText}}, RequiredTier: TierAny}
	signed := PolicySubject{ID: "any", Version: "1.0.0", Tier: TierVerified, PublisherKeyID: pk.ID()}
	if got := p.Refusal(signed); got != "" {
		t.Fatalf("signed by the listed key refused: %q", got)
	}
	unsigned := PolicySubject{ID: "any", Version: "1.0.0", Tier: TierVerified}
	if got := p.Refusal(unsigned); got == "" {
		t.Fatal("unsigned plugin passed a publisher-key allow list")
	}
}

func TestPolicyRefusal_RequiredTier(t *testing.T) {
	verified := Policy{RequiredTier: TierVerified}
	if got := verified.Refusal(subject("a", "1.0.0", TierHashPinned)); got != "Your organisation requires extensions to be verified." {
		t.Fatalf("verified tier: %q", got)
	}
	pinned := Policy{RequiredTier: TierHashPinned}
	if got := pinned.Refusal(subject("a", "1.0.0", TierUnverified)); got != "Your organisation requires extensions to be hash-pinned or verified." {
		t.Fatalf("pinned tier: %q", got)
	}
	if got := pinned.Refusal(subject("a", "1.0.0", TierVerified)); got != "" {
		t.Fatalf("verified refused under hash-pinned: %q", got)
	}
	if got := pinned.Refusal(subject("a", "1.0.0", TierDev)); got == "" {
		t.Fatal("dev folder passed a hash-pinned requirement")
	}
}

func TestPolicyRefusal_BlockedCapabilities(t *testing.T) {
	p := Policy{RequiredTier: TierAny, BlockedCapabilities: []string{"fetch"}}
	if got := p.Refusal(subject("a", "1.0.0", TierVerified, "open-url", "fetch")); got != "Your organisation blocks extensions that can reach the network." {
		t.Fatalf("capability: %q", got)
	}
	if got := p.Refusal(subject("a", "1.0.0", TierVerified, "open-url")); got != "" {
		t.Fatalf("undeclared capability refused: %q", got)
	}
}

func TestPolicyRefusal_BuiltInIsNeverRefused(t *testing.T) {
	p := Policy{Allow: []PolicyRule{{ID: "other"}}, RequiredTier: TierVerified, BlockedCapabilities: []string{"fetch"}}
	if got := p.Refusal(PolicySubject{ID: "mill-drawing", Builtin: true, Capabilities: []string{"fetch"}}); got != "" {
		t.Fatalf("built-in refused: %q", got)
	}
}

func TestPolicySourceAllowed(t *testing.T) {
	open := Policy{}
	if !open.SourceAllowed("anything", "/tmp/x") {
		t.Fatal("no allowedSources must allow every source")
	}
	p := Policy{AllowedSources: []string{"bank-market", "https://git.example.test/mill"}}
	if !p.SourceAllowed("bank-market", "") {
		t.Fatal("listed marketplace refused")
	}
	if !p.SourceAllowed("", "https://git.example.test/mill/acme-notes") {
		t.Fatal("address under a listed one refused")
	}
	if p.SourceAllowed("other", "https://github.com/x/y") {
		t.Fatal("unlisted source allowed")
	}
	if !strings.HasPrefix(p.SourceRefusal(), "Your organisation allows installs only from bank-market") {
		t.Fatalf("sentence = %q", p.SourceRefusal())
	}
}

// The managed state, the default path and the env override are the
// three placements the file can sit in.
func TestPolicyState_ManagedAndPaths(t *testing.T) {
	if (PolicyState{}).Managed() || !(PolicyState{Present: true}).Managed() {
		t.Fatal("Managed must mirror Present")
	}
	def := DefaultPolicyPath()
	if !strings.HasSuffix(def, policyFileName) {
		t.Fatalf("DefaultPolicyPath() = %q", def)
	}
	t.Setenv(PolicyPathEnv, "")
	if PolicyPath() != def {
		t.Fatalf("PolicyPath() = %q, want the default", PolicyPath())
	}
	t.Setenv(PolicyPathEnv, "  /tmp/override.json  ")
	if PolicyPath() != "/tmp/override.json" {
		t.Fatalf("PolicyPath() = %q, want the trimmed override", PolicyPath())
	}
}

// signedByKey verifies the folder's signature against the policy's own
// key set, answering 0 for every non-match.
func TestSignedByKey(t *testing.T) {
	pub, priv, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	other, _, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	writePlugin(t, dir, "signed", `{"id":"signed","name":"S","version":"1"}`, nil)
	folder := filepath.Join(dir, "signed")
	hash, _ := ContentHash(folder)
	if got := signedByKey(folder, hash, nil); got != 0 {
		t.Fatalf("no keys: %d", got)
	}
	if got := signedByKey(folder, hash, []minisign.PublicKey{pub}); got != 0 {
		t.Fatalf("no signature file: %d", got)
	}
	if got := signedByKey("", hash, []minisign.PublicKey{pub}); got != 0 {
		t.Fatalf("no folder: %d", got)
	}
	if err := os.WriteFile(filepath.Join(folder, SignatureFile), minisign.Sign(priv, []byte(hash)), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := signedByKey(folder, hash, []minisign.PublicKey{other, pub}); got != pub.ID() {
		t.Fatalf("signed: %d, want %d", got, pub.ID())
	}
	if got := signedByKey(folder, "not-the-hash", []minisign.PublicKey{pub}); got != 0 {
		t.Fatalf("wrong hash: %d", got)
	}
	p := Policy{Allow: []PolicyRule{{PublisherKey: mustKeyText(t, pub)}, {PublisherKey: "junk"}}}
	if keys := p.publisherKeys(); len(keys) != 1 || keys[0].ID() != pub.ID() {
		t.Fatalf("publisherKeys = %v", keys)
	}
}

func mustKeyText(t *testing.T, pk minisign.PublicKey) string {
	t.Helper()
	text, err := pk.MarshalText()
	if err != nil {
		t.Fatal(err)
	}
	return string(text)
}

// A broken policy file answers every install question with the one
// fail-closed sentence; an absent file answers none.
func TestPolicyInstallGates_FailClosed(t *testing.T) {
	writePolicy(t, `{"version": 1`)
	if err := policyInstallRefusal(Manifest{ID: "x"}, TierDev, "", "", ""); err != ErrPolicyUnreadable {
		t.Fatalf("install under broken policy = %v", err)
	}
	if err := policySourceRefusal("", "https://example.test/x"); err != ErrPolicyUnreadable {
		t.Fatalf("source under broken policy = %v", err)
	}
	t.Setenv(PolicyPathEnv, filepath.Join(t.TempDir(), "absent.json"))
	if err := policyInstallRefusal(Manifest{ID: "x"}, TierDev, "", "", ""); err != nil {
		t.Fatalf("install without policy = %v", err)
	}
	if err := policySourceRefusal("", "https://example.test/x"); err != nil {
		t.Fatalf("source without policy = %v", err)
	}
}

// The source gate applies at install preview time too: a listed source
// passes, an unlisted one fails with the source sentence.
func TestPolicyInstallGates_SourceList(t *testing.T) {
	writePolicy(t, `{"version": 1, "managedBy": "Org", "allowedSources": ["bank-market", "https://git.example.test/mill"]}`)
	if err := policyInstallRefusal(Manifest{ID: "x"}, TierDev, "other", "", ""); err == nil || !strings.Contains(err.Error(), "allows installs only from") {
		t.Fatalf("unlisted marketplace = %v", err)
	}
	if err := policyInstallRefusal(Manifest{ID: "x"}, TierDev, "bank-market", "", ""); err != nil {
		t.Fatalf("listed marketplace = %v", err)
	}
	if err := policySourceRefusal("", "https://git.example.test/mill/acme-notes"); err != nil {
		t.Fatalf("listed locator = %v", err)
	}
	if err := policySourceRefusal("bank-market", ""); err != nil {
		t.Fatalf("listed marketplace source = %v", err)
	}
}

// An install refusal under the policy carries the policy code and the
// refusal sentence; the static checks' refusal sentences capitalise
// the detail and name the file.
func TestPolicyInstallGates_RefusalSentences(t *testing.T) {
	writePolicy(t, `{"version": 1, "managedBy": "Org", "block": [{"id": "acme-notes"}]}`)
	err := policyInstallRefusal(Manifest{ID: "acme-notes", Version: "1.0.0"}, TierVerified, "", "", "")
	if err == nil || err.Error() != "Your organisation blocks this extension." {
		t.Fatalf("block refusal = %v", err)
	}
	if ue, ok := usererror.Of(err); !ok || ue.Code != PolicyRefusedCode {
		t.Fatalf("refusal code = %v", err)
	}
	if got := installRefusalSentence("standard rule 25: main.js: reaches bad.example without declaring it"); got != "Reaches bad.example without declaring it (main.js)." {
		t.Fatalf("sentence = %q", got)
	}
	if got := installRefusalSentence("bare finding"); got != "Bare finding." {
		t.Fatalf("bare = %q", got)
	}
}
