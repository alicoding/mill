package pluginsvc

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// conform_standard_context.go is standard rule 35 (docs/goals/0349
// S2c): a `when` clause naming `plugin.<key>` where this plugin's own
// scripts never write that key with api.context.set/call('context.set')
// anywhere is very likely a typo or an author's key that never got
// wired up -- advisory, like rule 34, since Mill still loads and runs
// the plugin exactly as declared either way.

// contextSetKeyRe finds every literal key argument a context.set call
// writes, in either spelling a plugin's own source carries: a
// same-DOM/framed-activation script calling api.context.set(key, ...)
// directly, or an entry page reaching the same door by name over its
// frame's call(method, ...args) -- call('context.set', key, ...). Only
// a literal string key is ever findable this way; a computed key
// (template literal, variable) is invisible to a static scan, so this
// rule can only ever under-warn, never falsely accuse a key the
// plugin's own runtime does write.
var contextSetKeyRe = regexp.MustCompile(`(?:api\.context\.set\(|call\(\s*['"` + "`" + `]context\.set['"` + "`" + `]\s*,)\s*(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|` + "`" + `([^` + "`" + `\\]*(?:\\.[^` + "`" + `\\]*)*)` + "`" + `)`)

// contextSetKeys collects every literal key a plugin's own scripts
// pass to context.set, in either spelling.
func contextSetKeys(scripts map[string]string) map[string]bool {
	keys := map[string]bool{}
	for _, src := range scripts {
		for _, match := range contextSetKeyRe.FindAllStringSubmatch(src, -1) {
			keys[jsLabelValue(match)] = true
		}
	}
	return keys
}

// factIdentifiers walks a `when` expression's own lexical rules --
// skipping the CONTENTS of every quoted string, so a literal value
// never misreads as a fact reference -- and returns every bare
// identifier token it finds (architecture.md: structured text is
// parsed, never matched). It does not need the full grammar rule 35
// cares about only WHICH facts an expression names, not whether it is
// otherwise well-formed.
func factIdentifiers(when string) []string {
	var idents []string
	runes := []rune(when)
	for i := 0; i < len(runes); {
		c := runes[i]
		switch {
		case c == '\'' || c == '"':
			quote := c
			i++
			for i < len(runes) && runes[i] != quote {
				i++
			}
			i++ // skip the closing quote, or run past the end on an unterminated string -- rule 35 only ever under-warns
		case unicode.IsLetter(c) || c == '_':
			start := i
			for i < len(runes) && (unicode.IsLetter(runes[i]) || unicode.IsDigit(runes[i]) || runes[i] == '_' || runes[i] == '.' || runes[i] == '-') {
				i++
			}
			idents = append(idents, string(runes[start:i]))
		default:
			i++
		}
	}
	return idents
}

// conformUndeclaredContextKeys is standard rule 35.
func conformUndeclaredContextKeys(m Manifest, scripts map[string]string) []string {
	setKeys := contextSetKeys(scripts)
	var warnings []string
	seen := map[string]bool{}
	for _, id := range sortedMenuIDs(m.Contributes.Menus) {
		for _, item := range m.Contributes.Menus[id] {
			for _, ident := range factIdentifiers(item.When) {
				key, ok := strings.CutPrefix(ident, "plugin.")
				if !ok || setKeys[key] {
					continue
				}
				warningKey := id + "\x00" + item.Command + "\x00" + key
				if seen[warningKey] {
					continue
				}
				seen[warningKey] = true
				warnings = append(warnings, fmt.Sprintf("standard rule 35: menu %q item %q references plugin.%s, which this plugin's own scripts never set with context.set", id, item.Command, key))
			}
		}
	}
	return warnings
}
