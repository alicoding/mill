package secretimport

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

// readTestdata parses a fixture under testdata/, prepending a
// byte-order mark first when bom is true.
func readTestdata(t *testing.T, path string, bom bool) ([]Row, string) {
	t.Helper()
	body, err := os.ReadFile(path) //nolint:gosec // path is always a literal testdata/*.csv passed by a call site in this file
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var buf bytes.Buffer
	if bom {
		buf.WriteString("\ufeff")
	}
	buf.Write(body)
	rows, name, err := ReadCSV(&buf)
	if err != nil {
		t.Fatalf("ReadCSV: %v", err)
	}
	return rows, name
}

func TestReadCSV_ChromiumExport(t *testing.T) {
	rows, name := readTestdata(t, "testdata/chromium.csv", false)
	if name != "chromium-csv" || len(rows) != 1 {
		t.Fatalf("%s %+v", name, rows)
	}
	if rows[0] != (Row{Title: "Example", Username: "example-user-1", Password: "not-a-real-secret-1", URL: "https://example.com", Notes: "hello"}) { //nolint:gosec // a fixture test credential, not a real secret
		t.Fatalf("row = %+v", rows[0])
	}
}

func TestReadCSV_ApplePasswordsExport(t *testing.T) {
	rows, name := readTestdata(t, "testdata/apple-passwords.csv", false)
	if name != "apple-passwords-csv" || len(rows) != 1 || rows[0].Title != "Bank" || rows[0].Password != "not-a-real-secret-2" {
		t.Fatalf("%s %+v", name, rows)
	}
}

func TestReadCSV_OnePasswordExport(t *testing.T) {
	rows, name := readTestdata(t, "testdata/onepassword.csv", false)
	if name != "onepassword-csv" || len(rows) != 1 || rows[0].Username != "example-user-3" || rows[0].Notes != "note" {
		t.Fatalf("%s %+v", name, rows)
	}
}

func TestReadCSV_BitwardenExport(t *testing.T) {
	rows, name := readTestdata(t, "testdata/bitwarden.csv", false)
	if name != "bitwarden-csv" || len(rows) != 1 || rows[0].URL != "https://store.example" || rows[0].Username != "example-user-4" {
		t.Fatalf("%s %+v", name, rows)
	}
}

// A file whose header names nothing recognizable is refused whole:
// nothing is guessed, nothing is imported.
func TestReadCSV_RefusesAnUnknownHeader(t *testing.T) {
	for _, body := range []string{"a,b,c\n1,2,3\n", "", "just one line with no commas\n"} {
		if _, _, err := ReadCSV(strings.NewReader(body)); err == nil {
			t.Errorf("%q was accepted", body)
		}
	}
}

// Rows that are not entries -- a blank trailer, a section marker --
// are dropped rather than stored as empty records.
func TestReadCSV_SkipsRowsThatAreNotEntries(t *testing.T) {
	rows, _ := readTestdata(t, "testdata/skip-rows.csv", false)
	if len(rows) != 1 || rows[0].Title != "Real" {
		t.Fatalf("rows = %+v", rows)
	}
}

// A leading byte-order mark is what a spreadsheet writes; it must not
// hide the first column's name.
func TestReadCSV_ToleratesAByteOrderMark(t *testing.T) {
	rows, name := readTestdata(t, "testdata/chromium.csv", true)
	if name != "chromium-csv" || len(rows) != 1 {
		t.Fatalf("%s %+v", name, rows)
	}
}
