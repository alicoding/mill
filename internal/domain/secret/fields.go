package secret

import (
	"sort"
	"strings"
)

// The entry IS the record (goal 0306 S4): beside the five named
// columns every credential manager shares, an entry carries its own
// custom fields and tags. A field is a name, a value, and whether the
// value is hidden until asked for; a tag is a plain word the browse
// surface filters on. Both are stored the way a foreign KDBX editor
// already understands -- custom string fields, and the same Tags
// string the vault already wrote -- so nothing here makes the file
// less readable elsewhere.

// Field is one custom field on an entry. Protected marks a value that
// stays hidden until the reader asks for it (the KDBX protected flag,
// the same one the password itself carries).
type Field struct {
	Name      string
	Value     string
	Protected bool
}

// reservedFieldNames are the keys an entry's own columns already own.
// A custom field may never take one of them, and a stored value under
// one is never listed back as a field.
var reservedFieldNames = map[string]bool{
	"Title": true, "UserName": true, "Password": true, "URL": true, "Notes": true, "Tags": true,
}

// MillAttributePrefix marks the attributes Mill writes for its own
// bookkeeping (the entry's kind, the source it reads through). They
// stay internal: never offered as a field, never listed as one.
const MillAttributePrefix = "Mill-"

// IsReservedField reports whether a stored key belongs to the entry's
// own columns or to Mill's own bookkeeping, rather than being a custom
// field the reader authored.
func IsReservedField(name string) bool {
	return reservedFieldNames[name] || strings.HasPrefix(name, MillAttributePrefix)
}

// tagSeparators: a tag list is written with semicolons and read with
// either, because KDBX tooling in the wild writes both.
const tagSeparators = ";,"

// ParseTags splits a stored tag string into its tags, trimmed, with
// blanks and duplicates dropped and the original order kept.
func ParseTags(stored string) []string {
	var out []string
	seen := map[string]bool{}
	for _, raw := range strings.FieldsFunc(stored, func(r rune) bool { return strings.ContainsRune(tagSeparators, r) }) {
		tag := strings.TrimSpace(raw)
		if tag == "" || seen[strings.ToLower(tag)] {
			continue
		}
		seen[strings.ToLower(tag)] = true
		out = append(out, tag)
	}
	return out
}

// FormatTags joins tags for storage.
func FormatTags(tags []string) string { return strings.Join(NormalizeTags(tags), ";") }

// NormalizeTags trims, drops blanks, and drops case-insensitive
// duplicates -- what a caller's list becomes before it is stored.
func NormalizeTags(tags []string) []string {
	return ParseTags(strings.Join(tags, ";"))
}

// FieldNames lists a record's field names, sorted -- what the browse
// surface's search matches against without carrying any value.
func FieldNames(fields []Field) []string {
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if name := strings.TrimSpace(f.Name); name != "" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}
