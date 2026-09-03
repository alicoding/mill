// Package vaultref is the reference grammar every secret-referenceable
// field shares: "<provider>:<id>". "vault:<id>" names an entry of
// Mill's own vault (the original and default provider); "env:<source-
// id>/<KEY>" names a key of a dotenv secret source (ADR-0050). A
// field holds the reference, never the value; the secret service
// resolves it at the moment of use and records the read.
package vaultref

import "strings"

const Prefix = "vault:"

// ProviderVault is the default provider; ProviderEnv the dotenv
// source provider. Any other prefix is not a reference.
const (
	ProviderVault = "vault"
	ProviderEnv   = "env"
	ProviderBruno = "bruno"
	ProviderOP    = "op"
	ProviderBW    = "bw"
)

var providers = map[string]bool{ProviderVault: true, ProviderEnv: true, ProviderBruno: true, ProviderOP: true, ProviderBW: true}

// Split separates a reference into its provider and provider-local id.
func Split(value string) (provider, id string, ok bool) {
	p, rest, found := strings.Cut(value, ":")
	if !found || !providers[p] || rest == "" {
		return "", "", false
	}
	return p, rest, true
}

// Parse returns the id the secret service resolves: for the vault
// provider the bare entry id (every existing "vault:<id>" reference
// and resolver keeps working unchanged); for any other provider the
// provider-qualified id ("env:<source>/<KEY>"), which the secret
// service dispatches by prefix.
func Parse(value string) (id string, ok bool) {
	provider, rest, found := Split(value)
	if !found {
		return "", false
	}
	if provider == ProviderVault {
		return rest, true
	}
	return provider + ":" + rest, true
}

// Ref builds a reference for a provider and its local id.
func Ref(provider, id string) string { return provider + ":" + id }
