package secretsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretvault"
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

	found, err := s.FindDotenvFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0].RelPath != "api/.env" || found[0].Keys != 2 || found[0].Label != "api/.env" || found[0].Tag != "api" {
		t.Fatalf("found = %+v", found)
	}
	if _, err := s.FindDotenvFiles(""); err == nil {
		t.Error("a scan with no folder must be refused")
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
	found, _ := s.FindDotenvFiles(root)
	added, err := s.AddDotenvSources(root, []string{found[0].Path})
	if err != nil || added != 1 {
		t.Fatalf("added = %d %v", added, err)
	}
	if len(created) != 1 || created[0][0] != "api/.env" || created[0][1] != "env" {
		t.Fatalf("created = %+v", created)
	}
}

func TestImportDotenvKeys_StoresEachKeyTaggedWithItsFolder(t *testing.T) {
	s := openVaultService(t)
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "api", ".env"), "API_TOKEN=tok-1\nOTHER=x\n")

	found, _ := s.FindDotenvFiles(root)
	imported, err := s.ImportDotenvKeys(root, []string{found[0].Path})
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
