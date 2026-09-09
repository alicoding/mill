package secretsvc

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// referenceTestService builds a vault WITH one plain entry, one
// source-backed entry (an adopted key), and one enabled dotenv source
// holding a second, not-yet-adopted key -- one harness exercising both
// halves of ListReferences.
func referenceTestService(t *testing.T) *SecretService {
	t.Helper()
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	if err := os.WriteFile(envPath, []byte("API_TOKEN=tok-123\nOTHER=x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	src := secretsource.Source{ID: "proj-env", Label: "Project .env", Kind: secretsource.KindEnv, Path: envPath, UpdatedAt: time.Now()}

	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{src} })
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	return s
}

// TestListReferences_NamesEveryReferenceNeverAValue pins contract item
// 2's shape: a plain vault entry, an adopted source-backed entry, and a
// not-yet-adopted source key all appear, each naming its own kind/
// source correctly, and never once carries a value string.
func TestListReferences_NamesEveryReferenceNeverAValue(t *testing.T) {
	s := referenceTestService(t)
	plain, err := s.CreateSecret("API token", "", "top-secret-value", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	adopted, err := s.CreateSecret("Adopted API token", "", "", "", "", nil, "", "env:proj-env/API_TOKEN", nil)
	if err != nil {
		t.Fatalf("CreateSecret (source-backed): %v", err)
	}

	refs, err := s.ListReferences()
	if err != nil {
		t.Fatalf("ListReferences: %v", err)
	}

	byRef := map[string]Reference{}
	for _, r := range refs {
		byRef[r.Ref] = r
		if r.Label == "" || r.Ref == "" {
			t.Errorf("row with an empty label/ref: %+v", r)
		}
	}

	plainRef := "vault:" + plain.ID
	pr, ok := byRef[plainRef]
	if !ok || pr.Source != nil || pr.Unresolved {
		t.Errorf("plain entry row = %+v, want Source=nil Unresolved=false", pr)
	}

	adoptedRef := "vault:" + adopted.ID
	ar, ok := byRef[adoptedRef]
	if !ok || ar.Source == nil || ar.Source.ID != "proj-env" || ar.Unresolved {
		t.Errorf("adopted entry row = %+v, want Source=proj-env Unresolved=false", ar)
	}

	keyRef := "env:proj-env/OTHER"
	kr, ok := byRef[keyRef]
	if !ok || kr.Label != "OTHER" || kr.Source == nil || kr.Source.ID != "proj-env" || kr.Unresolved {
		t.Errorf("bare source-key row = %+v, want label OTHER, Source=proj-env, Unresolved=false", kr)
	}

	// The adopted key's own bare reference (env:proj-env/API_TOKEN)
	// still lists too -- adopting into the vault doesn't remove the
	// source's own row, same as the Secrets list itself shows both.
	if _, ok := byRef["env:proj-env/API_TOKEN"]; !ok {
		t.Errorf("bare env:proj-env/API_TOKEN row missing, want both the adopted entry and the bare key listed")
	}
}

// TestListReferences_UnresolvedKeyOrGoneSource pins the unresolved
// state: a source-backed entry whose key vanished from its source is
// unresolved; one whose SOURCE itself was removed is unresolved with no
// Source object (distinct from a resolvable one).
func TestListReferences_UnresolvedKeyOrGoneSource(t *testing.T) {
	s := referenceTestService(t)
	missingKey, err := s.CreateSecret("Missing key", "", "", "", "", nil, "", "env:proj-env/GONE", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	goneSource, err := s.CreateSecret("Gone source", "", "", "", "", nil, "", "env:not-configured/KEY", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	refs, err := s.ListReferences()
	if err != nil {
		t.Fatalf("ListReferences: %v", err)
	}
	byRef := map[string]Reference{}
	for _, r := range refs {
		byRef[r.Ref] = r
	}

	mk := byRef["vault:"+missingKey.ID]
	if !mk.Unresolved || mk.Source == nil || mk.Source.ID != "proj-env" {
		t.Errorf("missing-key row = %+v, want Unresolved=true, Source=proj-env (the source itself still exists)", mk)
	}
	gs := byRef["vault:"+goneSource.ID]
	if !gs.Unresolved || gs.Source != nil {
		t.Errorf("gone-source row = %+v, want Unresolved=true, Source=nil", gs)
	}
}

// TestListReferences_ExcludesTrashedVaultEntries pins goal 0406's rule
// (S3 Amendment 1): a trashed vault entry never appears -- ListSecrets
// (which this reuses) already excludes Trash's own Recycle Bin group,
// so a trashed entry's reference can never resolve to a value through
// this listing, silently or otherwise.
func TestListReferences_ExcludesTrashedVaultEntries(t *testing.T) {
	s := referenceTestService(t)
	created, err := s.CreateSecret("Will be trashed", "", "trashed-value", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	before, err := s.ListReferences()
	if err != nil {
		t.Fatalf("ListReferences: %v", err)
	}
	found := false
	for _, r := range before {
		if r.Ref == "vault:"+created.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("the entry must be listed before it is trashed")
	}

	if err := s.TrashSecret(created.ID); err != nil {
		t.Fatalf("TrashSecret: %v", err)
	}

	after, err := s.ListReferences()
	if err != nil {
		t.Fatalf("ListReferences: %v", err)
	}
	for _, r := range after {
		if r.Ref == "vault:"+created.ID {
			t.Fatalf("trashed entry %q still listed as a reference: %+v", created.ID, r)
		}
	}
}
