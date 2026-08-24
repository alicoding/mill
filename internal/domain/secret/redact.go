package secret

import "strings"

// RedactedPlaceholder replaces a known secret value wherever Redact
// finds it -- never the value itself, never a partial/truncated form
// (a truncated secret is still a partial leak).
const RedactedPlaceholder = "[redacted]"

// Redact returns text with every occurrence of every non-empty value in
// secrets replaced by RedactedPlaceholder -- goal 0185 Finding 4's own
// gap ("no way to redact because there is no enumerable set of secret
// values to redact against") closed now that the vault makes that set
// real. Longest-first: a shorter secret that happens to be a substring
// of a longer one never partially unmasks it (e.g. redacting "abc"
// before "abcdef" would leave "def" exposed in the output).
func Redact(secrets []string, text string) string {
	ordered := make([]string, 0, len(secrets))
	for _, s := range secrets {
		if s != "" {
			ordered = append(ordered, s)
		}
	}
	// Simple insertion sort by descending length -- secrets lists are
	// vault-sized (dozens, not thousands), not worth importing sort for.
	for i := 1; i < len(ordered); i++ {
		for j := i; j > 0 && len(ordered[j]) > len(ordered[j-1]); j-- {
			ordered[j], ordered[j-1] = ordered[j-1], ordered[j]
		}
	}
	for _, s := range ordered {
		text = strings.ReplaceAll(text, s, RedactedPlaceholder)
	}
	return text
}
