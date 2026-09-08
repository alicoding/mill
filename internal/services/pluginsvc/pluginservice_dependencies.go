package pluginsvc

import (
	"fmt"
	"regexp"

	"github.com/Masterminds/semver/v3"
)

// Extension interop (goal 0364): a plugin may declare that it needs
// another installed extension (Manifest.Dependencies) and which
// methods on its own activate() return value a dependant may call
// (Manifest.Exports). This file carries the two load-time shape
// checks (id pattern, version range, method-name shape -- run for
// every scan, since a malformed manifest is broken however it
// arrived) and the two install-time registry checks (standard rule 33:
// is the dependency actually installed, in range, and cycle-free --
// only meaningful with the OTHER installed manifests in hand, which
// only the install door has).

// DependencyContribution is one entry in Manifest.Dependencies: ID
// names another installed extension this one needs before it
// activates, Version a semver range (Masterminds/semver/v3 syntax,
// e.g. ">=1.0.0 <2.0.0") that extension's installed version must
// satisfy. The loader activates a dependency before its dependant
// (topological order); a dependant whose dependency never reaches
// 'loaded' waits rather than activates. A dependency id not installed
// or out of range refuses the INSTALL (standard rule 33) -- never a
// load-time check, since the registry of what else is installed only
// exists at install time.
type DependencyContribution struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

// Manifest.Exports names the methods on activate()'s returned object
// a DEPENDANT may call through api.extensions.get(id) -- Chrome's
// externally_connectable principle, gated by the callee: a name
// absent there is never reachable, however the caller asks. Plain
// (non-function) properties of the returned object are not gated --
// only a callable method is "reach" into the extension.

// exportNamePattern mirrors a plain JS identifier: an export name
// becomes a property lookup on the activate() return value and a key
// in a postMessage payload, never a path or an expression.
var exportNamePattern = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)

// validateDependencyShape is load-blocking (manifestProblem): every
// declared id must look like a plugin id, its version must be a
// version range Masterminds/semver/v3 can parse, and a plugin cannot
// depend on itself.
func validateDependencyShape(ownID string, deps []DependencyContribution) string {
	seen := map[string]bool{}
	for _, d := range deps {
		if !pluginIDPattern.MatchString(d.ID) {
			return fmt.Sprintf("dependency id %q must be lowercase letters, digits, and hyphens", d.ID)
		}
		if d.ID == ownID {
			return fmt.Sprintf("extension %q cannot depend on itself", ownID)
		}
		if seen[d.ID] {
			return fmt.Sprintf("dependency %q is declared twice", d.ID)
		}
		seen[d.ID] = true
		if _, err := semver.NewConstraint(d.Version); err != nil {
			return fmt.Sprintf("dependency %q version %q is not a version range: %s", d.ID, d.Version, err)
		}
	}
	return ""
}

// validateExportsShape is load-blocking: every declared export name
// must look like a plain method name, and no name twice.
func validateExportsShape(exports []string) string {
	seen := map[string]bool{}
	for _, name := range exports {
		if !exportNamePattern.MatchString(name) {
			return fmt.Sprintf("exported method %q must be a plain method name", name)
		}
		if seen[name] {
			return fmt.Sprintf("exported method %q is declared twice", name)
		}
		seen[name] = true
	}
	return ""
}

// installedManifests answers every OTHER extension's manifest this
// Mill currently has on disk, valid ones only -- a dependency check
// against a broken folder would report the wrong reason for the wrong
// problem. Built-ins are included (Manifest.Dependencies' own doc:
// "Built-ins may be depended on").
func (p *PluginService) installedManifests() map[string]Manifest {
	infos, _ := p.ListPlugins()
	out := make(map[string]Manifest, len(infos))
	for _, info := range infos {
		if info.Error == "" {
			out[info.Manifest.ID] = info.Manifest
		}
	}
	return out
}

// dependencyRefusalSentence is standard rule 33's one sentence: a
// dependency that is not installed and a dependency installed at the
// wrong version read the same to the person installing -- "the
// version this extension needs is not present" either way.
func dependencyRefusalSentence(dep DependencyContribution) string {
	return fmt.Sprintf("This extension needs %s %s, which is not installed.", dep.ID, dep.Version)
}

// dependencyRefusals is standard rule 33, the install-time half:
// every declared dependency must resolve to an installed extension
// whose version satisfies the declared range.
func dependencyRefusals(deps []DependencyContribution, installed map[string]Manifest) []string {
	var refusals []string
	for _, dep := range deps {
		m, ok := installed[dep.ID]
		if !ok {
			refusals = append(refusals, dependencyRefusalSentence(dep))
			continue
		}
		constraint, err := semver.NewConstraint(dep.Version)
		if err != nil {
			refusals = append(refusals, dependencyRefusalSentence(dep))
			continue
		}
		version, err := semver.NewVersion(m.Version)
		if err != nil || !constraint.Check(version) {
			refusals = append(refusals, dependencyRefusalSentence(dep))
		}
	}
	return refusals
}

// dependencyCycle walks the dependency graph reachable from rootID --
// rootID's own DECLARED deps (the manifest being installed, not yet
// among installed) and every other extension's INSTALLED deps --
// answering the two ids whose edge closes a cycle, "" and false when
// none exists. A general cycle degrades to naming the pair that
// closed it, which is exactly the mutual case standard rule 33's
// sentence names.
func dependencyCycle(rootID string, deps []DependencyContribution, installed map[string]Manifest) (a, b string, found bool) {
	depsOf := func(id string) []DependencyContribution {
		if id == rootID {
			return deps
		}
		if m, ok := installed[id]; ok {
			return m.Dependencies
		}
		return nil
	}
	onStack := map[string]bool{rootID: true}
	var walk func(id string) (string, string, bool)
	walk = func(id string) (string, string, bool) {
		for _, d := range depsOf(id) {
			if d.ID == "" {
				continue
			}
			if onStack[d.ID] {
				return id, d.ID, true
			}
			onStack[d.ID] = true
			if fa, fb, ok := walk(d.ID); ok {
				return fa, fb, ok
			}
			delete(onStack, d.ID)
		}
		return "", "", false
	}
	return walk(rootID)
}
