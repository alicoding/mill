package secretsvc

import (
	"fmt"
	"sort"
	"strings"

	"context"

	"github.com/alicoding/mill/internal/adapters/brunosource"
	"github.com/alicoding/mill/internal/adapters/clisecrets"
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
		if src.Kind.IsPlugin() {
			for _, k := range s.pluginSourceKeys(src) {
				out = append(out, secret.Summary{ID: vaultref.Ref(vaultref.ProviderPlugin, src.ID+"/"+k), Title: k + " — " + src.Label, Kind: secret.KindText, UpdatedAt: src.UpdatedAt})
			}
			continue
		}
		if isCLIKind(src.Kind) {
			entries, err := cliEntries(src)
			if err != nil {
				continue // the source's own row states the problem (SourceProblems)
			}
			for _, e := range entries {
				out = append(out, secret.Summary{ID: vaultref.Ref(providerOf(src), src.ID+"/"+e.ID), Title: e.Title + " — " + src.Label, Kind: secret.KindText, UpdatedAt: src.UpdatedAt})
			}
			continue
		}
		provider, keys, label := sourceKeys(src)
		for _, k := range keys {
			out = append(out, secret.Summary{
				ID:        vaultref.Ref(provider, src.ID+"/"+k),
				Title:     k + " — " + label,
				Kind:      secret.KindText,
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
	if src.Kind.IsPlugin() {
		v, perr := s.resolvePluginSource(id, *src, key, actx)
		return v, true, perr
	}
	if isCLIKind(src.Kind) {
		v, cerr := cliResolve(*src, key)
		if cerr != nil {
			s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeError, cerr.Error())
			return "", true, cerr
		}
		s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeRead, "")
		return v, true, nil
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
	if src.Kind.IsPlugin() {
		return vaultref.ProviderPlugin
	}
	switch src.Kind {
	case secretsource.KindBruno:
		return vaultref.ProviderBruno
	case secretsource.KindOnePassword:
		return vaultref.ProviderOP
	case secretsource.KindBitwarden:
		return vaultref.ProviderBW
	}
	return vaultref.ProviderEnv
}

func isCLIKind(k secretsource.Kind) bool {
	return k == secretsource.KindOnePassword || k == secretsource.KindBitwarden
}

// cliEntries / cliResolve are the CLI providers' seams
// (internal/adapters/clisecrets), swappable for tests.
var cliEntries = func(src secretsource.Source) ([]clisecrets.Entry, error) {
	if src.Kind == secretsource.KindOnePassword {
		return clisecrets.ListOnePassword(context.Background(), src.Path)
	}
	return clisecrets.ListBitwarden(context.Background())
}

var cliResolve = func(src secretsource.Source, id string) (string, error) {
	if src.Kind == secretsource.KindOnePassword {
		return clisecrets.ResolveOnePassword(context.Background(), id)
	}
	return clisecrets.ResolveBitwarden(context.Background(), id)
}

// SourceProblems reports, per source id, why a source currently lists
// nothing ("" for a healthy one): a missing or locked CLI, an
// unreadable file or collection. The Configure row shows it.
func (s *SecretService) SourceProblems() map[string]string {
	out := map[string]string{}
	for _, src := range s.sourcesSnapshot() {
		var err error
		switch {
		case src.Kind.IsPlugin():
			if problem := s.pluginSourceProblem(src); problem != "" {
				out[src.ID] = problem
			}
			continue
		case isCLIKind(src.Kind):
			_, err = cliEntries(src)
		case src.Kind == secretsource.KindBruno:
			_, err = brunosource.Read(src.Path)
		default:
			_, err = dotenvsource.Keys(src.Path)
		}
		if err != nil {
			out[src.ID] = err.Error()
		}
	}
	return out
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
