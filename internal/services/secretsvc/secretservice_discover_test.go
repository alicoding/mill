package secretsvc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func openVaultService(t *testing.T) *SecretService {
	t.Helper()
	dir := t.TempDir()
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	if err := s.SetupVault(); err != nil {
		t.Fatal(err)
	}
	return s
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestFindDotenvFiles_NamesEachFilesSourceLabelAndTag(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "api", ".env"), "API_TOKEN=tok\nOTHER=x\n")
	writeFile(t, filepath.Join(root, "node_modules", "p", ".env"), "NOPE=1\n")

	res, err := s.FindDotenvFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Skipped) != 0 {
		t.Fatalf("skipped = %+v", res.Skipped)
	}
	if len(res.Found) != 1 || res.Found[0].RelPath != "api/.env" || res.Found[0].Keys != 2 || res.Found[0].Label != "api/.env" || res.Found[0].Tag != "api" {
		t.Fatalf("found = %+v", res.Found)
	}
	if _, err := s.FindDotenvFiles(""); err == nil {
		t.Error("a scan with no folder must be refused")
	}
}

// A file whose path is already a configured source is marked so, however
// the paths were written (trailing slashes, a leading "~"): the picker
// shows it disabled rather than adding a duplicate (goal 0367).
func TestFindDotenvFiles_MarksAFileAlreadyConfiguredAsASource(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "api", ".env"), "A=1\n")
	writeFile(t, filepath.Join(root, "web", ".env"), "B=2\n")
	s.SetSourcesLister(func() []secretsource.Source {
		return []secretsource.Source{
			{ID: "api-env", Label: "api/.env", Kind: secretsource.KindEnv, Path: filepath.Join(root, "api", ".env")},
			{ID: "work-op", Label: "Work 1Password", Kind: secretsource.KindOnePassword, Path: "Work"},
		}
	})

	res, err := s.FindDotenvFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Found) != 2 || !res.Found[0].AlreadySource || res.Found[1].AlreadySource {
		t.Fatalf("found = %+v", res.Found)
	}
}

// A file that cannot be parsed is named with its reason in the scan
// result, never silently omitted (goal 0367).
func TestFindDotenvFiles_NamesAFileItCannotParse(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, ".env"), "A=1\n")
	writeFile(t, filepath.Join(root, "api", ".env.broken"), "\"BAD LINE\n")

	res, err := s.FindDotenvFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Found) != 1 || len(res.Skipped) != 1 || res.Skipped[0].RelPath != "api/.env.broken" || res.Skipped[0].Reason == "" {
		t.Fatalf("result = %+v", res)
	}
}

func TestAddDotenvSources_CreatesOneSourcePerChosenFile(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "api", ".env"), "A=1\n")
	writeFile(t, filepath.Join(root, "web", ".env"), "B=2\n")

	var created [][3]string
	s.SetSourceCreator(func(label, kind, path string) error {
		created = append(created, [3]string{label, kind, path})
		return nil
	})
	res, _ := s.FindDotenvFiles(root)
	added, err := s.AddDotenvSources(root, []string{res.Found[0].Path})
	if err != nil || added != 1 {
		t.Fatalf("added = %d %v", added, err)
	}
	if len(created) != 1 || created[0][0] != "api/.env" || created[0][1] != "env" {
		t.Fatalf("created = %+v", created)
	}
}

// A chosen path that already names a configured source is skipped, so a
// direct call from anywhere else cannot add the duplicate the disabled
// picker checkbox guards against (goal 0367).
func TestAddDotenvSources_SkipsAPathAlreadyConfiguredAsASource(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	envPath := filepath.Join(root, "api", ".env")
	writeFile(t, envPath, "A=1\n")
	s.SetSourcesLister(func() []secretsource.Source {
		return []secretsource.Source{{ID: "api-env", Label: "api/.env", Kind: secretsource.KindEnv, Path: envPath, UpdatedAt: time.Now()}}
	})
	var created int
	s.SetSourceCreator(func(label, kind, path string) error {
		created++
		return nil
	})
	added, err := s.AddDotenvSources(root, []string{envPath})
	if err != nil || added != 0 || created != 0 {
		t.Fatalf("added = %d created = %d err = %v", added, created, err)
	}
}

func TestImportDotenvKeys_StoresEachKeyTaggedWithItsFolder(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "api", ".env"), "API_TOKEN=tok-1\nOTHER=x\n")

	res, _ := s.FindDotenvFiles(root)
	imported, err := s.ImportDotenvKeys(root, []string{res.Found[0].Path})
	if err != nil || imported != 2 {
		t.Fatalf("imported = %d %v", imported, err)
	}
	list, err := s.ListSecrets()
	if err != nil {
		t.Fatal(err)
	}
	// A fresh vault ships its own example entry; only what this import
	// created is asserted on.
	var titles []string
	var importedID string
	for _, e := range list {
		if len(e.Tags) == 0 {
			continue
		}
		titles = append(titles, e.Title)
		if strings.Join(e.Tags, ",") != "api" {
			t.Errorf("%s tags = %v", e.Title, e.Tags)
		}
		if e.Title == "API_TOKEN" {
			importedID = e.ID
		}
	}
	if strings.Join(titles, ",") != "API_TOKEN,OTHER" {
		t.Fatalf("titles = %v", titles)
	}
	full, err := s.RevealSecret(importedID)
	if err != nil {
		t.Fatal(err)
	}
	if full.Password != "tok-1" || full.Origin != "import:api/.env" {
		t.Fatalf("entry = %+v", full)
	}
}

// A second import of the same file updates its entries in place --
// same ids, changed values honored, never a second copy (goal 0367).
func TestImportDotenvKeys_TwiceUpdatesNeverDuplicates(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	envPath := filepath.Join(root, "api", ".env")
	writeFile(t, envPath, "API_TOKEN=tok-1\n")
	res, _ := s.FindDotenvFiles(root)
	if _, err := s.ImportDotenvKeys(root, []string{res.Found[0].Path}); err != nil {
		t.Fatal(err)
	}

	firstList, err := s.ListSecrets()
	if err != nil {
		t.Fatal(err)
	}
	var firstID string
	for _, e := range firstList {
		if e.Title == "API_TOKEN" && e.Origin == "import:api/.env" {
			firstID = e.ID
		}
	}
	if firstID == "" {
		t.Fatalf("the imported entry is not listed as its own summary: %+v", firstList)
	}

	writeFile(t, envPath, "API_TOKEN=tok-2\n")
	imported, err := s.ImportDotenvKeys(root, []string{res.Found[0].Path})
	if err != nil || imported != 1 {
		t.Fatalf("second import = %d %v", imported, err)
	}
	secondList, err := s.ListSecrets()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, e := range secondList {
		if e.Title == "API_TOKEN" && e.Origin == "import:api/.env" {
			count++
			if e.ID != firstID {
				t.Errorf("re-import should update entry %q in place, got %q", firstID, e.ID)
			}
		}
	}
	if count != 1 {
		t.Fatalf("one entry after two imports, got %d", count)
	}
	full, err := s.RevealSecret(firstID)
	if err != nil || full.Password != "tok-2" {
		t.Fatalf("updated value = %q %v", full.Password, err)
	}
}

// A locked vault is refused UP FRONT -- no entry written, the reader's
// sentence returned -- never after a partial import (goal 0367).
func TestImportDotenvKeys_LockedVaultIsRefusedUpFront(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "api", ".env"), "API_TOKEN=tok\n")
	s.LockVault()
	res, err := s.FindDotenvFiles(root)
	if err != nil || len(res.Found) != 1 {
		t.Fatalf("scan = %+v %v", res, err)
	}
	imported, err := s.ImportDotenvKeys(root, []string{res.Found[0].Path})
	if imported != 0 || !errors.Is(err, ErrDotenvImportLocked) {
		t.Fatalf("locked import = %d %v", imported, err)
	}
	ue, ok := usererror.Of(err)
	if !ok || ue.Code != "vault-locked-import" || ue.Message != "Unlock the vault to import keys." {
		t.Fatalf("locked import error = %+v", err)
	}
}
