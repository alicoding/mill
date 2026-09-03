package secretsvc

import (
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/adapters/brunosource"
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
		provider, keys, label := sourceKeys(src)
		for _, k := range keys {
			out = append(out, secret.Summary{
				ID:        vaultref.Ref(provider, src.ID+"/"+k),
				Title:     k + " — " + label,
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
		if candidate.ID == sourceID && providerOf(candidate) == provider {
			c := candidate
			src = &c
		}
	}
	if src == nil {
		err = fmt.Errorf("secret source %q is not configured", sourceID)
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, err.Error())
		return "", true, err
	}
	values, err := dotenvsource.Read(envPathOf(*src))
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

// providerOf names the reference provider a source answers to.
func providerOf(src secretsource.Source) string {
	if src.Kind == secretsource.KindBruno {
		return vaultref.ProviderBruno
	}
	return vaultref.ProviderEnv
}

// envPathOf is the dotenv file a source's values come from: the path
// itself for an env source, the collection root's .env for Bruno.
func envPathOf(src secretsource.Source) string {
	if src.Kind == secretsource.KindBruno {
		if c, err := brunosource.Read(src.Path); err == nil {
			return c.EnvPath
		}
	}
	return src.Path
}

// sourceKeys lists a source's secret NAMES and the label the picker
// shows beside them: an env file's keys; for a Bruno collection, the
// .env's keys plus every name its environments declare as secret (so
// what the collection expects is visible even before the .env has it),
// labelled by the collection's own name.
func sourceKeys(src secretsource.Source) (provider string, keys []string, label string) {
	if src.Kind != secretsource.KindBruno {
		k, err := dotenvsource.Keys(src.Path)
		if err != nil {
			return vaultref.ProviderEnv, nil, src.Label
		}
		return vaultref.ProviderEnv, k, src.Label
	}
	c, err := brunosource.Read(src.Path)
	if err != nil {
		return vaultref.ProviderBruno, nil, src.Label
	}
	seen := map[string]bool{}
	for _, k := range c.SecretNames {
		seen[k] = true
	}
	if envKeys, err := dotenvsource.Keys(c.EnvPath); err == nil {
		for _, k := range envKeys {
			seen[k] = true
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return vaultref.ProviderBruno, out, c.Name
}
