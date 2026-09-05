package secretsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/secretsource"
)

// Plugin-contributed sources (goal 0306 S4) join the provider port
// (ADR-0050) as one more provider, not as a second path: an extension
// LISTS names and READS one value, and this service applies what came
// back through the same presence gate, guardrail and audit line every
// built-in provider passes. The extension is a producer only -- it
// never receives another source's value, a vault entry, or the
// reference grammar.

// PluginSourceBridge is the extension platform's half of that port,
// injected so this service never depends on the plugin platform.
type PluginSourceBridge interface {
	// SourceList returns the source's secret NAMES for a kind of
	// "plugin:<pluginID>/<sourceID>" and the path the user configured.
	SourceList(kind, path string) ([]string, error)
	// SourceResolve reads one named secret's value.
	SourceResolve(kind, path, key string) (string, error)
	// SourceProblem states why the kind cannot answer right now ("" when
	// it can): a problem code for the states the reader can act on.
	SourceProblem(kind string) string
}

// SetPluginSources wires the bridge, late like every other seam here.
// Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (s *SecretService) SetPluginSources(b PluginSourceBridge) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pluginSources = b
}

func (s *SecretService) pluginBridge() PluginSourceBridge {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pluginSources
}

// pluginSourceKeys lists a plugin-backed source's key names, empty when
// no extension can answer -- the source's own row states why
// (SourceProblems), the picker stays honest.
func (s *SecretService) pluginSourceKeys(src secretsource.Source) []string {
	bridge := s.pluginBridge()
	if bridge == nil {
		return nil
	}
	keys, err := bridge.SourceList(string(src.Kind), src.Path)
	if err != nil {
		return nil
	}
	return keys
}

// pluginSourceProblem answers SourceProblems for a plugin-backed
// source: the platform's own state first (a missing or disabled
// extension), then whether it can actually list.
func (s *SecretService) pluginSourceProblem(src secretsource.Source) string {
	bridge := s.pluginBridge()
	if bridge == nil {
		return pluginsvcProblemMissing
	}
	if problem := bridge.SourceProblem(string(src.Kind)); problem != "" {
		return problem
	}
	if _, err := bridge.SourceList(string(src.Kind), src.Path); err != nil {
		return err.Error()
	}
	return ""
}

// pluginAuditLabel names the extension that answered beside the key and
// the source, so a read in the access history says which extension
// produced the value, not only which source.
func pluginAuditLabel(src secretsource.Source, key string) string {
	label := key + " — " + src.Label
	if pluginID, _, ok := src.Kind.PluginIDs(); ok {
		label += " (" + pluginID + ")"
	}
	return label
}

// pluginsvcProblemMissing mirrors the plugin platform's own code for an
// extension that is not installed. Duplicated rather than imported so
// this service keeps no dependency on the plugin platform; the two are
// pinned together by TestPluginSourceProblemCodes_MatchThePlatform.
const pluginsvcProblemMissing = "plugin-not-installed"

// resolvePluginSource is resolveProvider's plugin branch: the
// extension hands back a value it read itself, and every outcome --
// refusal included -- is recorded against the reference, the same
// audit line a dotenv read leaves.
func (s *SecretService) resolvePluginSource(id string, src secretsource.Source, key string, actx secretaudit.AccessContext) (string, error) {
	label := pluginAuditLabel(src, key)
	bridge := s.pluginBridge()
	if bridge == nil {
		err := fmt.Errorf("secret source %q needs its extension installed", src.Label)
		s.recordAccess(id, label, actx, secretaudit.OutcomeError, err.Error())
		return "", err
	}
	value, err := bridge.SourceResolve(string(src.Kind), src.Path, key)
	if err != nil {
		s.recordAccess(id, label, actx, secretaudit.OutcomeError, err.Error())
		return "", err
	}
	if value == "" {
		err = fmt.Errorf("secret source %q has no key %q", src.Label, key)
		s.recordAccess(id, label, actx, secretaudit.OutcomeError, err.Error())
		return "", err
	}
	s.recordAccess(id, label, actx, secretaudit.OutcomeRead, "")
	return value, nil
}
