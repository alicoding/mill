package secretsvc

import (
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

// Reference is one nameable secret reference (goal 0408 S3 decision
// 7): the vault's own entries, plus every enabled source's currently-
// readable keys -- what an agent can point a field at, never a value.
// Wire shape for both secrets_list_references (millmcpservice_secrets.go)
// and any future frontend consumer of the same listing.
type Reference struct {
	Label      string           `json:"label"`
	Ref        string           `json:"ref"`
	Source     *ReferenceSource `json:"source"`
	Kind       secret.Kind      `json:"kind"`
	Unresolved bool             `json:"unresolved"`
}

// ReferenceSource names the configured source a reference resolves
// through, nil for a plain vault entry with no source.
type ReferenceSource struct {
	ID    string            `json:"id"`
	Label string            `json:"label"`
	Kind  secretsource.Kind `json:"kind"`
}

// ListReferences lists every current reference by NAME, never a value
// -- vault entries (Trash excluded: ListSecrets already never lists a
// trashed entry, goal 0406) and every enabled source's own keys
// (ListProviderSecrets, live-read). A vault entry backed by a source
// (SourceRef set) carries that source and is marked unresolved exactly
// as the picker's own caption already computes it (SecretRefUnresolved)
// plus the "the source itself is gone" state that function doesn't
// cover on its own.
func (s *SecretService) ListReferences() ([]Reference, error) {
	entries, err := s.ListSecrets()
	if err != nil {
		return nil, err
	}
	out := make([]Reference, 0, len(entries))
	for _, e := range entries {
		out = append(out, s.vaultReference(e))
	}

	providerSecrets, err := s.ListProviderSecrets()
	if err != nil {
		return nil, err
	}
	for _, p := range providerSecrets {
		if row, ok := providerReference(p, s); ok {
			out = append(out, row)
		}
	}

	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Label) < strings.ToLower(out[j].Label) })
	return out, nil
}

// vaultReference builds one vault entry's own row, resolving its
// source when SourceRef names one.
func (s *SecretService) vaultReference(e secret.Summary) Reference {
	row := Reference{Label: e.Title, Ref: vaultref.Ref(vaultref.ProviderVault, e.ID), Kind: e.Kind}
	if e.SourceRef == "" {
		return row
	}
	provider, rest, ok := vaultref.Split(e.SourceRef)
	sourceID, _, cutOK := "", "", false
	if ok {
		sourceID, _, cutOK = strings.Cut(rest, "/")
	}
	src, found := secretsource.Source{}, false
	if ok && cutOK {
		src, found = s.findSource(provider, sourceID)
	}
	if found {
		row.Source = &ReferenceSource{ID: src.ID, Label: src.Label, Kind: src.Kind}
	}
	unresolved, _, _ := s.SecretRefUnresolved(e.SourceRef)
	row.Unresolved = unresolved || !found
	return row
}

// providerReference builds one not-yet-adopted source key's own row --
// ListProviderSecrets only ever emits an id for a currently-enabled,
// currently-readable source, so this row is never unresolved; ok=false
// for an id that doesn't parse or whose source vanished between the
// two calls above (a race lasting at most a moment, dropped rather than
// shown half-labelled, same posture as the frontend's own
// providerSecretRows).
func providerReference(p secret.Summary, s *SecretService) (Reference, bool) {
	provider, rest, ok := vaultref.Split(p.ID)
	if !ok {
		return Reference{}, false
	}
	sourceID, key, found := strings.Cut(rest, "/")
	if !found {
		return Reference{}, false
	}
	src, srcOK := s.findSource(provider, sourceID)
	if !srcOK {
		return Reference{}, false
	}
	return Reference{
		Label:  key,
		Ref:    p.ID,
		Source: &ReferenceSource{ID: src.ID, Label: src.Label, Kind: src.Kind},
		Kind:   p.Kind,
	}, true
}
