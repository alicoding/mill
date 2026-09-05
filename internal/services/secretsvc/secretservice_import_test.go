package secretsvc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const chromiumExport = "name,url,username,password,note\n" +
	"Example,https://example.com,alice,pw-import-1,hello\n" +
	"Bank,https://bank.example,bob,pw-import-2,\n"

func writeExport(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "passwords.csv")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPreviewExport_CountsWithoutStoringAnything(t *testing.T) {
	s := openVaultService(t)
	before, _ := s.ListSecrets()
	preview, err := s.PreviewExport(writeExport(t, chromiumExport))
	if err != nil || preview.Count != 2 || preview.FileName != "passwords.csv" {
		t.Fatalf("preview = %+v %v", preview, err)
	}
	after, _ := s.ListSecrets()
	if len(after) != len(before) {
		t.Fatal("a preview must store nothing")
	}
}

func TestImportExport_StoresEachRowTaggedAndDeletesTheFile(t *testing.T) {
	s := openVaultService(t)
	path := writeExport(t, chromiumExport)
	imported, err := s.ImportExport(path, true)
	if err != nil || imported != 2 {
		t.Fatalf("imported = %d %v", imported, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("the export must be deleted when asked -- it holds every password in plain text")
	}
	list, _ := s.ListSecrets()
	var found int
	for _, e := range list {
		if strings.Join(e.Tags, ",") != "imported" {
			continue
		}
		found++
		full, err := s.RevealSecret(e.ID)
		if err != nil {
			t.Fatal(err)
		}
		if full.Origin != "import:passwords.csv" {
			t.Errorf("%s origin = %q", e.Title, full.Origin)
		}
	}
	if found != 2 {
		t.Fatalf("tagged entries = %d", found)
	}
}

func TestImportExport_KeepsTheFileWhenNotAsked(t *testing.T) {
	s := openVaultService(t)
	path := writeExport(t, chromiumExport)
	if _, err := s.ImportExport(path, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("the export must stay when deletion was not asked for")
	}
}

// A file no known layout matches is refused whole, with the code the
// surface words its own sentence from; nothing is stored.
func TestPreviewExport_RefusesAnUnreadableFile(t *testing.T) {
	s := openVaultService(t)
	before, _ := s.ListSecrets()
	_, err := s.PreviewExport(writeExport(t, "a,b,c\n1,2,3\n"))
	if !errors.Is(err, ErrUnreadableExport) {
		t.Fatalf("err = %v", err)
	}
	if _, err := s.ImportExport(writeExport(t, "a,b,c\n1,2,3\n"), true); !errors.Is(err, ErrUnreadableExport) {
		t.Fatalf("import err = %v", err)
	}
	after, _ := s.ListSecrets()
	if len(after) != len(before) {
		t.Fatal("a refused file must store nothing")
	}
}
