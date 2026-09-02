package atlas

import (
	"strings"
	"unicode/utf8"
)

// noteTitleMaxRunes bounds a derived note title to one legible line
// in any list that renders it.
const noteTitleMaxRunes = 80

// NoteDisplayName derives the name a note is listed by (docs/goals/
// 0278): a note has no title field -- its body IS the note -- so the
// converged convention (the first line names the note) applies. The
// first non-blank line, with a leading markdown heading or list
// marker stripped, cut to noteTitleMaxRunes; a note with no text at
// all lists as "Untitled note". Derived on every read, never stored,
// so editing the first line renames the note everywhere at once.
func NoteDisplayName(text string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		line = strings.TrimLeft(line, "#")
		line = strings.TrimSpace(line)
		for _, marker := range []string{"- [ ]", "- [x]", "- [X]"} {
			line = strings.TrimPrefix(line, marker)
		}
		line = strings.TrimSpace(strings.TrimLeft(line, "-*+> "))
		if line == "" {
			continue
		}
		if utf8.RuneCountInString(line) > noteTitleMaxRunes {
			runes := []rune(line)
			return strings.TrimSpace(string(runes[:noteTitleMaxRunes-1])) + "…"
		}
		return line
	}
	return "Untitled note"
}
