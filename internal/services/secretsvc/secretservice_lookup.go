package secretsvc

import "strings"

// LookupVaultSecretByEnvName answers the coding loop's own
// placeholder->vault-key mapping rule (goal 0240 S2, wiring.
// WireCodingLoopSecrets): a captured command's `${VAR}` placeholder
// names a vault entry when that entry's TITLE, normalized the same way
// as VAR, matches exactly -- e.g. a vault entry titled "GitHub Token"
// matches `${GITHUB_TOKEN}`. Deliberately simple and stated rather than
// fuzzy/inferred (Mill makes no AI calls, SPEC.md §1.1): name the vault
// entry after the env var it stands in for and Mill finds it. A tie
// (two entries normalizing to the same name) resolves to the first
// match in ListSecrets' own title-sorted order -- rare enough in
// practice (it means two differently-titled entries collapsed to the
// same normalized form) that a documented, deterministic tiebreak beats
// adding ambiguity-detection machinery for it.
//
// This is a LABEL lookup only, never a decrypt: goal 0203 S3's audit
// contract only records an actual secret-VALUE read, and this answers
// "does a vault entry exist for this name," called from the Confirm
// screen's own preview path where nothing has run yet. Exported for
// wiring.WireCodingLoopSecrets only, never a frontend RPC -- the
// Confirm screen reaches this through codeloopsvc.PreviewCommandBlock's
// own SecretRequirements field instead.
//
//wails:ignore
func (s *SecretService) LookupVaultSecretByEnvName(varName string) (id, label string, found bool) {
	entries, err := s.vault.List()
	if err != nil {
		return "", "", false
	}
	target := normalizeSecretEnvName(varName)
	for _, e := range entries {
		if normalizeSecretEnvName(e.Title) == target {
			return e.ID, e.Title, true
		}
	}
	return "", "", false
}

// normalizeSecretEnvName canonicalizes a name for the mapping rule
// above: uppercase, with every run of non-alphanumeric characters
// collapsed to a single underscore -- "GitHub Token", "github-token",
// and "GITHUB_TOKEN" all normalize identically.
func normalizeSecretEnvName(name string) string {
	var b strings.Builder
	lastUnderscore := false
	for _, r := range strings.ToUpper(name) {
		switch {
		case r >= 'A' && r <= 'Z' || r >= '0' && r <= '9':
			b.WriteRune(r)
			lastUnderscore = false
		case !lastUnderscore:
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}
