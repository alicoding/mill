package secretimport

import (
	"strings"
	"testing"
)

func read(t *testing.T, body string) ([]Row, string) {
	t.Helper()
	rows, name, err := ReadCSV(strings.NewReader(body))
	if err != nil {
		t.Fatalf("ReadCSV: %v", err)
	}
	return rows, name
}

func TestReadCSV_ChromiumExport(t *testing.T) {
	rows, name := read(t, "name,url,username,password,note\nExample,https://example.com,alice,pw-1,hello\n")
	if name != "chromium-csv" || len(rows) != 1 {
		t.Fatalf("%s %+v", name, rows)
	}
	if rows[0] != (Row{Title: "Example", Username: "alice", Password: "pw-1", URL: "https://example.com", Notes: "hello"}) {
		t.Fatalf("row = %+v", rows[0])
	}
}

func TestReadCSV_ApplePasswordsExport(t *testing.T) {
	rows, name := read(t, "Title,URL,Username,Password,Notes,OTPAuth\nBank,https://bank.example,bob,pw-2,,otpauth://x\n")
	if name != "apple-passwords-csv" || len(rows) != 1 || rows[0].Title != "Bank" || rows[0].Password != "pw-2" {
		t.Fatalf("%s %+v", name, rows)
	}
}

func TestReadCSV_OnePasswordExport(t *testing.T) {
	rows, name := read(t, "Title,Username,Password,Notes,Type\nMail,carol,pw-3,note,Login\n")
	if name != "onepassword-csv" || len(rows) != 1 || rows[0].Username != "carol" || rows[0].Notes != "note" {
		t.Fatalf("%s %+v", name, rows)
	}
}

func TestReadCSV_BitwardenExport(t *testing.T) {
	body := "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n" +
		",,login,Store,a note,,0,https://store.example,dave,pw-4,\n"
	rows, name := read(t, body)
	if name != "bitwarden-csv" || len(rows) != 1 || rows[0].URL != "https://store.example" || rows[0].Username != "dave" {
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
	rows, _ := read(t, "name,url,username,password,note\nReal,https://a.example,alice,pw,\n,,,,\nTitled but empty,,,,\n")
	if len(rows) != 1 || rows[0].Title != "Real" {
		t.Fatalf("rows = %+v", rows)
	}
}

// A leading byte-order mark is what a spreadsheet writes; it must not
// hide the first column's name.
func TestReadCSV_ToleratesAByteOrderMark(t *testing.T) {
	rows, name := read(t, "\ufeffname,url,username,password,note\nExample,https://e.example,alice,pw,\n")
	if name != "chromium-csv" || len(rows) != 1 {
		t.Fatalf("%s %+v", name, rows)
	}
}
