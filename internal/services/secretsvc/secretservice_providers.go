package secretsvc

import (
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/adapters/dotenvsource"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

// The provider port (ADR-0050): the vault stays the default, resolved
// by bare id; a provider-qualified id ("env:<source>/<KEY>") dispatches
// to a read-only view over the user's own store. Every resolve still
// passes recordAccess, with the provider-qualified id as the entry id,
// so the audit names the source that answered.

// SourcesLister hands the service the user's enabled secret sources
// (the Configure entity); wired late like every other seam.
type SourcesLister func() []secretsource.Source

func (s *SecretService) SetSourcesLister(fn SourcesLister) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sources = fn
}

func (s *SecretService) sourcesSnapshot() []secretsource.Source {
	s.mu.Lock()
	fn := s.sources
	s.mu.Unlock()
	if fn == nil {
		return nil
	}
	return fn()
}

// ListProviderSecrets lists every key of every enabled source as a
// Summary whose ID is the reference itself and whose Title names the
// key and its source -- titles only, never a value; a source whose
// file cannot be read contributes nothing (the picker stays honest,
// the source's own row reports the problem).
func (s *SecretService) ListProviderSecrets() ([]secret.Summary, error) {
	var out []secret.Summary
	for _, src := range s.sourcesSnapshot() {
		keys, err := dotenvsource.Keys(src.Path)
		if err != nil {
			continue
		}
		for _, k := range keys {
			out = append(out, secret.Summary{
				ID:        vaultref.Ref(vaultref.ProviderEnv, src.ID+"/"+k),
				Title:     k + " — " + src.Label,
				UpdatedAt: src.UpdatedAt,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	return out, nil
}

// resolveProvider answers a provider-qualified id, or ok=false when
// the id is a bare vault id.
func (s *SecretService) resolveProvider(id string, actx secretaudit.AccessContext) (value string, handled bool, err error) {
	provider, rest, ok := vaultref.Split(id)
	if !ok || provider == vaultref.ProviderVault {
		return "", false, nil
	}
	sourceID, key, found := strings.Cut(rest, "/")
	if !found || key == "" {
		err = fmt.Errorf("secret reference %q: expected env:<source>/<KEY>", id)
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, err.Error())
		return "", true, err
	}
	var src *secretsource.Source
	for _, candidate := range s.sourcesSnapshot() {
		if candidate.ID == sourceID {
			c := candidate
			src = &c
		}
	}
	if src == nil {
		err = fmt.Errorf("secret source %q is not configured", sourceID)
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, err.Error())
		return "", true, err
	}
	values, err := dotenvsource.Read(src.Path)
	if err != nil {
		s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeError, err.Error())
		return "", true, err
	}
	v, present := values[key]
	if !present {
		err = fmt.Errorf("secret source %q has no key %q", src.Label, key)
		s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeError, err.Error())
		return "", true, err
	}
	s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeRead, "")
	return v, true, nil
}
