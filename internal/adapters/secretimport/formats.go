// Package secretimport reads a password export the user made
// themselves and turns it into entries (goal 0306 S4).
//
// It reads an EXPORT and nothing else. Mill never reads a browser's or
// a manager's own credential database: reading another application's
// stored-credential store is exactly the technique ADR-0050 refuses
// (MITRE ATT&CK T1555.003), and no convenience earns it. The user
// exports from their own tool, Mill reads that file, and the file is
// offered for deletion straight after -- an export holds every
// password in plain text.
package secretimport

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
)

// Format is one recognized export layout: the header columns that
// identify it, and which of them carry the entry's own values. Column
// names are matched case-insensitively and trimmed, because exporters
// disagree on capitalization across versions.
type Format struct {
	// Name identifies the layout in code and in tests. It is never
	// shown to the reader: the surface says whether the file could be
	// read, never which tool it came from.
	Name string
	// Required columns must all be present for the layout to match.
	Required []string
	// The columns each value is read from, first match wins.
	Title    []string
	Username []string
	Password []string
	URL      []string
	Notes    []string
}

// formats are tried in order; the first whose required columns are all
// present wins. Ordering matters only where one layout's required set
// is a subset of another's, so the more specific layouts come first.
//
// Only the CSV layouts below are read -- a 1PUX or JSON password
// export is not recognized (goal 0306 S4). Revisit once the first
// reader shows up wanting an import that is not CSV.
var formats = []Format{
	{
		Name:     "bitwarden-csv",
		Required: []string{"name", "login_username", "login_password"},
		Title:    []string{"name"},
		Username: []string{"login_username"},
		Password: []string{"login_password"},
		URL:      []string{"login_uri"},
		Notes:    []string{"notes"},
	},
	{
		Name:     "apple-passwords-csv",
		Required: []string{"title", "url", "username", "password"},
		Title:    []string{"title"},
		Username: []string{"username"},
		Password: []string{"password"},
		URL:      []string{"url"},
		Notes:    []string{"notes"},
	},
	{
		Name:     "onepassword-csv",
		Required: []string{"title", "username", "password"},
		Title:    []string{"title"},
		Username: []string{"username"},
		Password: []string{"password"},
		URL:      []string{"url", "website"},
		Notes:    []string{"notes"},
	},
	{
		Name:     "chromium-csv",
		Required: []string{"name", "url", "username", "password"},
		Title:    []string{"name"},
		Username: []string{"username"},
		Password: []string{"password"},
		URL:      []string{"url"},
		Notes:    []string{"note", "notes"},
	},
}

// Row is one entry read out of an export.
type Row struct {
	Title    string
	Username string
	Password string
	URL      string
	Notes    string
}

// ErrUnrecognized is returned when no known layout matches the file's
// header. The surface states it as "Can't read this file as a password
// export."; nothing is imported.
var ErrUnrecognized = fmt.Errorf("unrecognized export layout")

// ReadCSV parses an export, returning its rows and the layout that
// matched. A row with no password and no username is skipped: exports
// carry section markers and blank trailers that are not entries.
func ReadCSV(r io.Reader) ([]Row, string, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return nil, "", ErrUnrecognized
	}
	index := headerIndex(header)
	format, ok := matchFormat(index)
	if !ok {
		return nil, "", ErrUnrecognized
	}
	var out []Row
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, "", ErrUnrecognized
		}
		row := Row{
			Title:    pick(index, record, format.Title),
			Username: pick(index, record, format.Username),
			Password: pick(index, record, format.Password),
			URL:      pick(index, record, format.URL),
			Notes:    pick(index, record, format.Notes),
		}
		if row.Password == "" && row.Username == "" {
			continue
		}
		if row.Title == "" {
			row.Title = row.URL
		}
		if row.Title == "" {
			continue
		}
		out = append(out, row)
	}
	return out, format.Name, nil
}

func headerIndex(header []string) map[string]int {
	index := make(map[string]int, len(header))
	for i, name := range header {
		key := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(name, "\ufeff")))
		if key == "" {
			continue
		}
		if _, seen := index[key]; !seen {
			index[key] = i
		}
	}
	return index
}

func matchFormat(index map[string]int) (Format, bool) {
	for _, f := range formats {
		matched := true
		for _, column := range f.Required {
			if _, ok := index[column]; !ok {
				matched = false
				break
			}
		}
		if matched {
			return f, true
		}
	}
	return Format{}, false
}

func pick(index map[string]int, record []string, columns []string) string {
	for _, column := range columns {
		i, ok := index[column]
		if !ok || i >= len(record) {
			continue
		}
		if v := strings.TrimSpace(record[i]); v != "" {
			return v
		}
	}
	return ""
}
