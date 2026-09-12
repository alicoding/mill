package pluginsvc

import (
	"fmt"
	"sort"
	"strings"
)

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
// still need Mill's own document (docs/goals/0380). The deciding fact
// is which door a kind's registration crosses: a kind not declared Tool
// registers through registerCanvasObject, a same-DOM-only door
// (plugin-frame/activation.ts never implements it, since a function
// cannot cross postMessage). A Tool kind registers through
// registerCanvasTool, which IS available framed -- but its own face
// still resolves only through the manifest's own Entry lookup, never a
// renderFace function the frame cannot send, so a Tool kind with no
// Entry still needs Mill's own document for its face. A kind is
// framed-safe only when it is BOTH Tool and Entry; one kind missing
// either is enough to need the grant, since the whole extension shares
// one activation.
func NeedsCanvasHost(m Manifest) bool {
	for _, o := range m.Contributes.CanvasObjects {
		if !o.Tool || o.Entry == "" {
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
	Capabilities        []string
	Hosts               []string
	AnyHost             bool
	NetworkGrantVersion int
	NetworkMethods      map[string][]string
	Kinds               []string
	UsesSecrets         bool
	CanvasHost          bool
}

// currentGrant reads one manifest's currently-declared set, the same
// shape PreviewInstalled shows -- what a fresh Allow would grant today.
func currentGrant(m Manifest) PluginGrant {
	var pv InstallPreview
	applyManifestToPreview(&pv, m, false)
	return PluginGrant{
		Capabilities: pv.Capabilities, Hosts: pv.NetworkHosts, AnyHost: pv.AnyHost,
		NetworkGrantVersion: pv.NetworkGrantVersion, NetworkMethods: pv.NetworkMethods,
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
	diff.NetworkGrantVersion = current.NetworkGrantVersion
	diff.NetworkMethods = widenedNetworkMethods(granted, current)
	diff.Kinds = newIn(current.Kinds, granted.Kinds)
	diff.UsesSecrets = current.UsesSecrets && !granted.UsesSecrets
	diff.CanvasHost = current.CanvasHost && !granted.CanvasHost
	widened = len(diff.Capabilities) > 0 || len(diff.Hosts) > 0 || diff.AnyHost || len(diff.NetworkMethods) > 0 || len(diff.Kinds) > 0 || diff.UsesSecrets || diff.CanvasHost
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

func widenedNetworkMethods(granted, current PluginGrant) map[string][]string {
	if granted.NetworkGrantVersion != 1 {
		if len(current.NetworkMethods) == 0 {
			return nil
		}
		return cloneMethodMap(current.NetworkMethods)
	}
	diff := map[string][]string{}
	for host, methods := range current.NetworkMethods {
		added := newIn(methods, granted.NetworkMethods[host])
		if len(added) > 0 {
			diff[host] = added
		}
	}
	if len(diff) == 0 {
		return nil
	}
	return diff
}

func manifestNetworkMethods(m Manifest) map[string][]string {
	sets := map[string]map[string]bool{}
	for _, network := range m.Contributes.Network {
		methods := network.Methods
		if len(methods) == 0 {
			methods = []string{"GET"}
		}
		if sets[network.Host] == nil {
			sets[network.Host] = map[string]bool{}
		}
		for _, method := range methods {
			sets[network.Host][strings.ToUpper(method)] = true
		}
	}
	out := make(map[string][]string, len(sets))
	for host, set := range sets {
		for method := range set {
			out[host] = append(out[host], method)
		}
		sort.Strings(out[host])
	}
	return out
}

func cloneMethodMap(methods map[string][]string) map[string][]string {
	if methods == nil {
		return nil
	}
	out := make(map[string][]string, len(methods))
	for host, values := range methods {
		out[host] = append([]string(nil), values...)
	}
	return out
}

// diffPreview turns a widen diff into the InstallPreview shape
// permissionLines() already renders (docs/goals/0375 S2): the "now
// also asks to" block is the same component the full list uses, fed
// only the new elements.
func diffPreview(diff PluginGrant) *InstallPreview {
	return &InstallPreview{Capabilities: diff.Capabilities, NetworkHosts: diff.Hosts, AnyHost: diff.AnyHost, NetworkGrantVersion: diff.NetworkGrantVersion, NetworkMethods: diff.NetworkMethods, Kinds: diff.Kinds, UsesSecrets: diff.UsesSecrets, CanvasHost: diff.CanvasHost}
}

const (
	pluginApprovalAllowed     = "allowed"
	pluginApprovalUnallowed   = "unallowed"
	pluginApprovalChanged     = "changed"
	pluginApprovalUnavailable = "unavailable"
)

func (p *PluginService) readApproval() (PluginApproval, error) {
	if p.trust == nil {
		return PluginApproval{}, fmt.Errorf("extension approval state is unavailable")
	}
	return p.trust.Approval()
}

// applyApprovalVerdict stamps the activation verdict and widened-permission
// detail from one detached approval snapshot.
func applyApprovalVerdict(info *PluginInfo, approval PluginApproval, approvalErr error) {
	if info.Builtin {
		return
	}
	info.ApprovalState = pluginApprovalUnavailable
	if approvalErr != nil || info.Error != "" || info.CodeHash == "" {
		return
	}
	if !containsString(approval.Allowed, info.Manifest.ID) {
		info.ApprovalState = pluginApprovalUnallowed
		return
	}
	lock, locked := approval.Locks[info.Manifest.ID]
	if !locked {
		if containsString(approval.LegacyUnpinned, info.Manifest.ID) {
			info.ApprovalState = pluginApprovalAllowed
		} else {
			info.ApprovalState = pluginApprovalUnallowed
		}
		return
	}
	if lock.Hash == "" {
		return
	}
	diff, widened := widenedFrom(lock.Grant, currentGrant(info.Manifest))
	if widened {
		info.Widened = diffPreview(diff)
		info.ApprovalState = pluginApprovalUnallowed
		return
	}
	if info.CodeHash == lock.Hash {
		info.ApprovalState = pluginApprovalAllowed
		return
	}
	if legacyGrantShape(lock.Grant) && info.ContentHash != "" && info.ContentHash == lock.Hash {
		info.ApprovalState = pluginApprovalAllowed
		return
	}
	info.ApprovalState = pluginApprovalChanged
}

// Widened reports whether id's manifest currently declares more than
// its recorded consent covers (docs/goals/0375 S2) -- the same signal
// scanOne stamps onto PluginInfo, exposed as its own predicate so the
// run-policy gate (settingsTrust.mayRun) can ask a plain question.
// Always false for a built-in or an invalid manifest.
func (p *PluginService) Widened(id string) bool {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil || !pluginIDPattern.MatchString(id) {
		return true
	}
	info, found := p.resolvePluginLocked(id)
	if !found || info.Builtin {
		return false
	}
	approval, err := p.readApproval()
	applyApprovalVerdict(&info, approval, err)
	return info.Widened != nil || info.ApprovalState == pluginApprovalUnavailable
}

// WidenedAgainst compares current package authority with one committed grant revision.
func WidenedAgainst(p *PluginService, id string, granted PluginGrant) bool {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil {
		return true
	}
	return widenedAgainstLocked(p, id, granted)
}

func widenedAgainstLocked(p *PluginService, id string, granted PluginGrant) bool {
	if !pluginIDPattern.MatchString(id) {
		return true
	}
	info := p.scanOneWithoutApproval(id)
	if info.Error != "" {
		return true
	}
	_, widened := widenedFrom(granted, currentGrant(info.Manifest))
	return widened
}

// PackageApprovalMatches checks the installed code identity and complete grant
// under one mutation/recovery boundary for one authorization decision.
func PackageApprovalMatches(p *PluginService, id, codeHash string, granted PluginGrant) bool {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil || codeHash == "" {
		return false
	}
	info := p.scanOneWithoutApproval(id)
	if info.Error != "" || info.Builtin {
		return false
	}
	if info.CodeHash != codeHash {
		return legacyGrantShape(granted) && info.ContentHash != "" && info.ContentHash == codeHash
	}
	_, widened := widenedFrom(granted, currentGrant(info.Manifest))
	return !widened
}

func legacyGrantShape(grant PluginGrant) bool {
	return len(grant.Capabilities) == 0 && len(grant.Hosts) == 0 && !grant.AnyHost && grant.NetworkGrantVersion == 0 && len(grant.NetworkMethods) == 0 && len(grant.Kinds) == 0 && !grant.UsesSecrets && !grant.CanvasHost
}

// CaptureGrantLocked reads one complete package identity while mutation ownership is held.
func CaptureGrantLocked(p *PluginService, id string) (version, hash string, grant PluginGrant, err error) {
	if !pluginIDPattern.MatchString(id) {
		return "", "", PluginGrant{}, fmt.Errorf("invalid extension id %q", id)
	}
	info := p.scanOneWithoutApproval(id)
	if info.Error != "" || info.Builtin {
		if info.Error == "" {
			info.Error = "built-in extensions do not use package approval"
		}
		return "", "", PluginGrant{}, fmt.Errorf("extension %q: %s", id, info.Error)
	}
	if info.CodeHash == "" {
		return "", "", PluginGrant{}, fmt.Errorf("extension %q code identity is unavailable", id)
	}
	return info.Manifest.Version, info.CodeHash, currentGrant(info.Manifest), nil
}
