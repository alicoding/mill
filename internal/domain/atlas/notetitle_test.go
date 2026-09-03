package atlas

import (
	"strings"
	"testing"
)

func TestNoteDisplayName(t *testing.T) {
	cases := map[string]struct{ text, want string }{
		"first line":                        {"Buy milk\nand eggs", "Buy milk"},
		"leading blank lines":               {"\n\n  Second line is first  \nmore", "Second line is first"},
		"heading marker":                    {"## Weekly plan\n- a", "Weekly plan"},
		"list marker":                       {"- first item\n- second", "first item"},
		"task marker":                       {"- [ ] call the bank", "call the bank"},
		"quote marker":                      {"> a thought", "a thought"},
		"only markers":                      {"#\n- \n", "Untitled note"},
		"empty":                             {"", "Untitled note"},
		"whitespace":                        {"   \n\t", "Untitled note"},
		"long line truncates":               {strings.Repeat("x", 100), strings.Repeat("x", 79) + "…"},
		"multibyte counts runes, not bytes": {strings.Repeat("é", 60), strings.Repeat("é", 60)},
	}
	for name, c := range cases {
		if got := NoteDisplayName(c.text); got != c.want {
			t.Errorf("%s: NoteDisplayName(%q) = %q, want %q", name, c.text, got, c.want)
		}
	}
}
