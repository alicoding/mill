package pluginsvc

// pluginGrants computes PluginInfo.Grants for one scanned manifest
// (docs/goals/0375 S1b): what a plugin was given outside the sandboxed
// activation frame every other non-built-in plugin runs inside. A
// built-in never carries a grant -- it already runs same-DOM by its
// own named transition (PluginInfo.Builtin), not by anything a
// manifest asked for. Split from pluginservice.go at the hand-written-
// file line limit (.claude/rules/architecture.md).
func pluginGrants(builtin bool, m Manifest) []string {
	if builtin || !NeedsCanvasHost(m) {
		return nil
	}
	return []string{"canvas-host"}
}

// NeedsCanvasHost answers whether a manifest's canvas contributions
// still need Mill's own document (docs/goals/0380): a kind declared as
// a framed tool draws through the bridge and needs none, so a manifest
// whose canvas kinds are all tools -- or which declares no canvas kind
// at all -- runs fully sandboxed. One same-DOM kind is enough to need
// the grant, since the whole extension shares one activation.
func NeedsCanvasHost(m Manifest) bool {
	for _, o := range m.Contributes.CanvasObjects {
		if !o.Tool {
			return true
		}
	}
	return false
}

// PluginGrant is the capability-shaped set a plugin's consent covers
// (docs/goals/0375 S2): the same reach a manifest declares, in the
// shape widen detection compares. The zero value is "nothing granted"
// -- comparing against it finds everything in a manifest new, the same
// answer as comparing against no record at all.
type PluginGrant struct {
	Capabilities []string
	Hosts        []string
	AnyHost      bool
	Kinds        []string
	UsesSecrets  bool
	CanvasHost   bool
}

// currentGrant reads one manifest's currently-declared set, the same
// shape PreviewInstalled shows -- what a fresh Allow would grant today.
func currentGrant(builtin bool, m Manifest) PluginGrant {
	var pv InstallPreview
	applyManifestToPreview(&pv, m, builtin)
	return PluginGrant{
		Capabilities: pv.Capabilities, Hosts: pv.NetworkHosts, AnyHost: pv.AnyHost,
		Kinds: pv.Kinds, UsesSecrets: pv.UsesSecrets, CanvasHost: pv.CanvasHost,
	}
}

// widenedFrom answers the elements current has that granted does not
// (MV3's re-consent-on-widen rule, docs/goals/0375 S2): an element only
// in granted (a narrowed capability) or already in both never appears
// in diff, so a narrowed or unchanged set answers widened=false with an
// empty diff and never re-gates.
func widenedFrom(granted, current PluginGrant) (diff PluginGrant, widened bool) {
	diff.Capabilities = newIn(current.Capabilities, granted.Capabilities)
	diff.Hosts = newIn(current.Hosts, granted.Hosts)
	diff.AnyHost = current.AnyHost && !granted.AnyHost
	diff.Kinds = newIn(current.Kinds, granted.Kinds)
	diff.UsesSecrets = current.UsesSecrets && !granted.UsesSecrets
	diff.CanvasHost = current.CanvasHost && !granted.CanvasHost
	widened = len(diff.Capabilities) > 0 || len(diff.Hosts) > 0 || diff.AnyHost || len(diff.Kinds) > 0 || diff.UsesSecrets || diff.CanvasHost
	return diff, widened
}

// newIn answers the elements of current absent from granted, nil when
// none.
func newIn(current, granted []string) []string {
	var out []string
	for _, c := range current {
		found := false
		for _, g := range granted {
			if g == c {
				found = true
				break
			}
		}
		if !found {
			out = append(out, c)
		}
	}
	return out
}

// diffPreview turns a widen diff into the InstallPreview shape
// permissionLines() already renders (docs/goals/0375 S2): the "now
// also asks to" block is the same component the full list uses, fed
// only the new elements.
func diffPreview(diff PluginGrant) *InstallPreview {
	return &InstallPreview{Capabilities: diff.Capabilities, NetworkHosts: diff.Hosts, AnyHost: diff.AnyHost, Kinds: diff.Kinds, UsesSecrets: diff.UsesSecrets, CanvasHost: diff.CanvasHost}
}

// widenedInfo answers scanOne's PluginInfo.Widened for one non-built-in
// manifest: nil when the plugin was never granted, or its current
// declared set is a subset of (or equal to) what it was granted.
func widenedInfo(trust PluginTrustReader, m Manifest) *InstallPreview {
	if trust == nil {
		return nil
	}
	granted, ok := trust.GrantOf(m.ID)
	if !ok {
		return nil
	}
	diff, widened := widenedFrom(granted, currentGrant(false, m))
	if !widened {
		return nil
	}
	return diffPreview(diff)
}

// Widened reports whether id's manifest currently declares more than
// its recorded consent covers (docs/goals/0375 S2) -- the same signal
// scanOne stamps onto PluginInfo, exposed as its own predicate so the
// run-policy gate (settingsTrust.mayRun) can ask a plain question.
// Always false for a built-in or an invalid manifest.
func (p *PluginService) Widened(id string) bool {
	return p.resolvePlugin(id).Widened != nil
}
