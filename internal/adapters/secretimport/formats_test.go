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
	rows, name := read(t, "name,url,username,password,note\nExample,https://example.com,example-user-1,not-a-real-secret-1,hello\n")
	if name != "chromium-csv" || len(rows) != 1 {
		t.Fatalf("%s %+v", name, rows)
	}
	if rows[0] != (Row{Title: "Example", Username: "example-user-1", Password: "not-a-real-secret-1", URL: "https://example.com", Notes: "hello"}) { //nolint:gosec // a fixture test credential, not a real secret
		t.Fatalf("row = %+v", rows[0])
	}
}

func TestReadCSV_ApplePasswordsExport(t *testing.T) {
	rows, name := read(t, "Title,URL,Username,Password,Notes,OTPAuth\nBank,https://bank.example,example-user-2,not-a-real-secret-2,,otpauth://x\n")
	if name != "apple-passwords-csv" || len(rows) != 1 || rows[0].Title != "Bank" || rows[0].Password != "not-a-real-secret-2" {
		t.Fatalf("%s %+v", name, rows)
	}
}

func TestReadCSV_OnePasswordExport(t *testing.T) {
	rows, name := read(t, "Title,Username,Password,Notes,Type\nMail,example-user-3,not-a-real-secret-3,note,Login\n")
	if name != "onepassword-csv" || len(rows) != 1 || rows[0].Username != "example-user-3" || rows[0].Notes != "note" {
		t.Fatalf("%s %+v", name, rows)
	}
}

func TestReadCSV_BitwardenExport(t *testing.T) {
	body := "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n" +
		",,login,Store,a note,,0,https://store.example,example-user-4,not-a-real-secret-4,\n"
	rows, name := read(t, body)
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
	rows, _ := read(t, "name,url,username,password,note\nReal,https://a.example,example-user-5,not-a-real-secret-5,\n,,,,\nTitled but empty,,,,\n")
	if len(rows) != 1 || rows[0].Title != "Real" {
		t.Fatalf("rows = %+v", rows)
	}
}

// A leading byte-order mark is what a spreadsheet writes; it must not
// hide the first column's name.
func TestReadCSV_ToleratesAByteOrderMark(t *testing.T) {
	rows, name := read(t, "\ufeffname,url,username,password,note\nExample,https://e.example,example-user-6,not-a-real-secret-6,\n")
	if name != "chromium-csv" || len(rows) != 1 {
		t.Fatalf("%s %+v", name, rows)
	}
}
