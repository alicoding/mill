package secretsvc

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"context"

	"github.com/alicoding/mill/internal/adapters/brunosource"
	"github.com/alicoding/mill/internal/adapters/clisecrets"
	"github.com/alicoding/mill/internal/adapters/dotenvsource"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/domain/usererror"
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
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, secretaudit.FailureKindOther, err.Error())
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
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, secretaudit.FailureKindOther, err.Error())
		return "", true, err
	}
	if src.Kind.IsPlugin() {
		v, perr := s.resolvePluginSource(id, *src, key, actx)
		return v, true, perr
	}
	if isCLIKind(src.Kind) {
		v, cerr := cliResolve(*src, key)
		if cerr != nil {
			s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeError, secretaudit.FailureKindOther, cerr.Error())
			return "", true, cerr
		}
		s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeRead, "", "")
		return v, true, nil
	}
	values, err := dotenvsource.Read(envPathOf(*src))
	if err != nil {
		s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeError, secretaudit.FailureKindOther, err.Error())
		return "", true, err
	}
	v, present := values[key]
	if !present {
		err = newErrUnresolvedReference(id, src.Label, key)
		s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeError, secretaudit.FailureKindUnresolvedReference,
			fmt.Sprintf("secret source %q has no key %q", src.Label, key))
		return "", true, err
	}
	s.recordAccess(id, key+" — "+src.Label, actx, secretaudit.OutcomeRead, "", "")
	return v, true, nil
}

// RevealProviderSecret resolves ref (a provider-qualified reference,
// "env:<source>/<KEY>" and friends) and returns its value -- the
// source-backed counterpart to RevealSecret, for a Secrets-list row
// backed by a configured source rather than the vault (goal 0408 S2).
// Records one ContextUIReveal audit line via resolveProvider itself,
// naming the source. Errors when ref is a bare vault id -- that row
// reveals through RevealSecret instead.
func (s *SecretService) RevealProviderSecret(ref string) (string, error) {
	value, handled, err := s.resolveProvider(ref, secretaudit.AccessContext{Context: secretaudit.ContextUIReveal})
	if !handled {
		return "", fmt.Errorf("secret reference %q is not a source reference", ref)
	}
	return value, err
}

// CopyProviderSecretToClipboard mirrors CopySecretToClipboard for a
// provider-qualified reference (goal 0408 S2): resolves through the
// provider port (which records its own ContextUICopy audit line, naming
// the source) and writes the clipboard with the same "don't clobber a
// newer copy" auto-clear CopySecretToClipboard already gives vault
// entries.
func (s *SecretService) CopyProviderSecretToClipboard(ref string) error {
	value, handled, err := s.resolveProvider(ref, secretaudit.AccessContext{Context: secretaudit.ContextUICopy})
	if !handled {
		return fmt.Errorf("secret reference %q is not a source reference", ref)
	}
	if err != nil {
		return err
	}
	if err := clipboardWriteFn(value); err != nil {
		return err
	}
	time.AfterFunc(clipboardAutoClear, func() {
		current, err := clipboardReadFn()
		if err != nil || current != value {
			return
		}
		_ = clipboardWriteFn("")
	})
	return nil
}

// ErrUnresolvedReference is a source-backed reference whose source
// still exists but no longer has the named key (goal 0408 S1) --
// distinct from a source that cannot be read at all, which keeps its
// own "can't be read" error. Ref/SourceLabel/Key are for a caller that
// needs the specific reference (the pre-run verdict's own line, a
// test); the marshalled sentence never repeats them, since a source's
// Label is arbitrary user text a one-sentence usererror cannot safely
// interpolate (usererror.ValidMessage bans a ": " chain anywhere in
// the sentence, and nothing stops a label from containing one).
type ErrUnresolvedReference struct {
	// Cause carries the code+sentence that actually crosses the Wails
	// boundary (usererror.MarshalForWails' own errors.As match). Named
	// rather than embedded: usererror.Error's own Error() method would
	// otherwise collide with the embedded field's identical implicit
	// name and hide it from Go's method promotion.
	Cause                 *usererror.Error
	Ref, SourceLabel, Key string
}

// Error satisfies the error interface by delegating to Cause.
func (e *ErrUnresolvedReference) Error() string { return e.Cause.Error() }

// Unwrap exposes Cause to errors.Is/As -- usererror.Of's own
// errors.As(err, &target) walk finds it here.
func (e *ErrUnresolvedReference) Unwrap() error { return e.Cause }

// newErrUnresolvedReference builds one, for a reference whose source
// answered but named no such key.
func newErrUnresolvedReference(ref, sourceLabel, key string) *ErrUnresolvedReference {
	return &ErrUnresolvedReference{
		Cause:       usererror.New("secret-reference-unresolved", "This reference's key isn't in its source anymore."),
		Ref:         ref,
		SourceLabel: sourceLabel,
		Key:         key,
	}
}

// SecretRefUnresolved reports whether ref names a key inside a
// currently-configured dotenv/Bruno source whose file no longer has
// it -- the pre-run verdict's own check (composition.
// SetSecretUnresolvedCheck, wired through configuresvc). Unlike
// ResolveSecretValue/resolveProvider, this never records an access: it
// asks about the source's current STATE, not a real read, the same
// audit-free posture SourceProblems and ListDotenvSourceKeys already
// hold. A plugin- or CLI-backed source answers false here -- their own
// resolution paths own their own gaps. Exported for wiring only, never
// a frontend RPC: the picker's own "unresolved" caption is computed
// client-side from data it already has (SecretPicker.tsx).
//
//wails:ignore
func (s *SecretService) SecretRefUnresolved(ref string) (unresolved bool, key, sourceLabel string) {
	provider, rest, ok := vaultref.Split(ref)
	if !ok || provider == vaultref.ProviderVault {
		return false, "", ""
	}
	sourceID, k, found := strings.Cut(rest, "/")
	if !found || k == "" {
		return false, "", ""
	}
	var src *secretsource.Source
	for _, candidate := range s.sourcesSnapshot() {
		if candidate.ID == sourceID && providerOf(candidate) == provider {
			c := candidate
			src = &c
		}
	}
	if src == nil || src.Kind.IsPlugin() || isCLIKind(src.Kind) {
		return false, "", ""
	}
	values, err := dotenvsource.Read(envPathOf(*src))
	if err != nil {
		return false, "", "" // unreadable is a different state (SourceProblems)
	}
	if _, present := values[k]; present {
		return false, "", ""
	}
	return true, k, src.Label
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

// ListDotenvSourceKeys reads one dotenv source's file and returns its
// key NAMES, sorted -- never a value. The source's own row expands to
// this list (goal 0367), read fresh on each expand; a source whose file
// cannot be read is answered with the sentence its row shows.
func (s *SecretService) ListDotenvSourceKeys(sourceID string) ([]string, error) {
	for _, src := range s.sourcesSnapshot() {
		if src.ID != sourceID {
			continue
		}
		if src.Kind != secretsource.KindEnv {
			return nil, fmt.Errorf("secret source %q is not a dotenv file", sourceID)
		}
		keys, err := dotenvsource.Keys(src.Path)
		if err != nil {
			return nil, usererror.Wrap("dotenv-source-unreadable", "The file for this source can't be read.", err)
		}
		return keys, nil
	}
	return nil, fmt.Errorf("secret source %q is not configured", sourceID)
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
