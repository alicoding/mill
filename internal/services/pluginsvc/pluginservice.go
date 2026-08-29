// Package pluginsvc is the out-of-tree plugin platform's backend
// (docs/goals/0249, un-gating docs/adr/0047 §4's loader): it scans the
// plugins directory for manifests, serves each plugin's own files to
// the webview, and carries the capability model's enforcement seam --
// a plugin never holds a dangerous primitive; it requests a guarded
// action here, the manifest's declared capability set is checked
// first (declare-in-manifest), and the guardrail rule core evaluates
// the actual use (evaluate-per-action, docs/adr/0047 §2/§3).
package pluginsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// Manifest is the converged plugin manifest shape (docs/adr/0047 §1:
// identity metadata + a declared capability set). Rendering
// contributions happen at activate() time through the host API, so
// they are not restated here; INGESTION claims are the deliberate
// exception (docs/goals/0251) -- both ingestion chains must consult
// them without running plugin code, so they live in Contributes.
type Manifest struct {
	ID             string              `json:"id"`
	Name           string              `json:"name"`
	Version        string              `json:"version"`
	Description    string              `json:"description"`
	Author         string              `json:"author"`
	MinMillVersion string              `json:"minMillVersion"`
	Capabilities   []string            `json:"capabilities"`
	Contributes    ManifestContributes `json:"contributes"`
}

// ManifestContributes is the manifest's declarative contribution
// point (docs/goals/0251, the VSCode-shaped convention): data other
// parts of Mill read to ROUTE to a plugin, distinct from capabilities
// (what a plugin may ask to do).
type ManifestContributes struct {
	CanvasObjects []CanvasObjectContribution `json:"canvasObjects"`
}

// CanvasObjectContribution claims the ingestion doors for one canvas
// object kind: which dropped-file extensions and which clipboard
// shapes land as this plugin's object. Payload shape is not declared
// here -- it derives from the object's own registered source (a
// fileExtensions claim requires a file-backed object landing
// mirrorPath+title; PastesURLs requires a url-backed one landing
// url+title), enforced host-side at registration.
type CanvasObjectContribution struct {
	Kind           string   `json:"kind"`
	FileExtensions []string `json:"fileExtensions"`
	PastesURLs     bool     `json:"pastesURLs"`
}

// PluginInfo is one scanned plugin as the Extensions surface and the
// loader see it. Error is a load-blocking validation problem stated
// for the human (the row renders it; the loader skips the plugin) --
// a plugin is either fully valid or visibly broken, never silently
// half-loaded.
type PluginInfo struct {
	Manifest Manifest
	Dir      string
	Error    string
}

// knownCapabilities is the enumerated capability vocabulary
// (docs/adr/0047 §2: enumerated, never free-text). It grows per real
// plugin request, never speculatively -- docs/goals/0249 carries the
// revisit trigger.
var knownCapabilities = map[string]bool{
	// open-url: ask Mill to open an http(s) URL in the default
	// browser. The plugin never receives the primitive; on approval
	// Mill itself performs the open.
	"open-url": true,
}

// pluginIDPattern pins ids to a filesystem- and URL-safe slug: the id
// doubles as the plugin's folder name and its asset-route segment, so
// anything outside this set would be a traversal or encoding hazard,
// not a style choice.
var pluginIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// PluginService is Wails-bound. openURL is injected so tests never
// shell out to the real OS handler.
type PluginService struct {
	dir       string
	guardrail *guardrailsvc.GuardrailService
	openURL   func(url string) error
}

func New(dir string, guardrail *guardrailsvc.GuardrailService) *PluginService {
	return &PluginService{dir: dir, guardrail: guardrail, openURL: windowing.OpenURL}
}

// PluginsDir returns the directory plugins are installed into --
// the Extensions page's install story shows and reveals it. The
// directory is created on first ask so "open the folder" never lands
// on a missing path.
func (p *PluginService) PluginsDir() (string, error) {
	if err := os.MkdirAll(p.dir, 0o750); err != nil {
		return "", fmt.Errorf("create plugins directory: %w", err)
	}
	return p.dir, nil
}

// RevealPluginsDir opens the plugins directory in the OS file manager.
func (p *PluginService) RevealPluginsDir() error {
	dir, err := p.PluginsDir()
	if err != nil {
		return err
	}
	return p.openInOS("file://" + dir)
}

func (p *PluginService) openInOS(url string) error {
	if p.openURL == nil {
		return fmt.Errorf("no URL opener available in this mode")
	}
	return p.openURL(url)
}

// ListPlugins scans the plugins directory fresh on every call (the
// Extensions page's Rescan is just another call) and returns every
// plugin folder with its manifest -- valid ones ready to load,
// invalid ones carrying their human-readable Error.
func (p *PluginService) ListPlugins() ([]PluginInfo, error) {
	entries, err := os.ReadDir(p.dir)
	if os.IsNotExist(err) {
		return []PluginInfo{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read plugins directory: %w", err)
	}
	infos := make([]PluginInfo, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		infos = append(infos, p.scanOne(e.Name()))
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Manifest.ID < infos[j].Manifest.ID })
	return infos, nil
}

func (p *PluginService) scanOne(folder string) PluginInfo {
	dir := filepath.Join(p.dir, folder)
	info := PluginInfo{Dir: dir, Manifest: Manifest{ID: folder}}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json")) // #nosec G304 G703 -- dir is this service's own plugins root joined with a ReadDir entry name
	if err != nil {
		info.Error = "manifest.json is missing or unreadable"
		return info
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		info.Error = "manifest.json is not valid JSON"
		return info
	}
	info.Manifest = m
	switch {
	case !pluginIDPattern.MatchString(m.ID):
		info.Error = "the manifest id must be lowercase letters, digits, and hyphens"
	case m.ID != folder:
		// The Obsidian convention, adopted deliberately: the folder IS
		// the identity, so a copied folder can never impersonate a
		// different plugin's id.
		info.Error = fmt.Sprintf("the manifest id %q must match the folder name %q", m.ID, folder)
	case strings.TrimSpace(m.Name) == "" || strings.TrimSpace(m.Version) == "":
		info.Error = "the manifest needs a name and a version"
	default:
		if _, err := os.Stat(filepath.Join(dir, "main.js")); err != nil { // #nosec G703 -- folder passed pluginIDPattern (no separators, no dots)
			info.Error = "main.js is missing"
		}
	}
	if info.Error == "" {
		for _, c := range m.Capabilities {
			if !knownCapabilities[c] {
				// Fail-closed: an unknown capability blocks the LOAD,
				// never silently narrows to the known set -- the user
				// sees exactly why the plugin won't run.
				info.Error = fmt.Sprintf("unknown capability %q", c)
				break
			}
		}
	}
	if info.Error == "" {
		info.Error = validateContributes(m.Contributes)
	}
	return info
}

// fileExtensionPattern pins a contributed extension claim to the
// ".ext" shape the drop router compares against (unitRegistry's own
// extensionOf yields a lowercased dot-prefixed extension).
var fileExtensionPattern = regexp.MustCompile(`^\.[a-z0-9]+$`)

// validateContributes fail-closes ingestion claims the same way an
// unknown capability does: a malformed claim blocks the load with a
// human-readable reason, never routes half-right.
func validateContributes(c ManifestContributes) string {
	for _, obj := range c.CanvasObjects {
		if !pluginIDPattern.MatchString(obj.Kind) {
			return fmt.Sprintf("contributed canvas object kind %q must be lowercase letters, digits, and hyphens", obj.Kind)
		}
		for _, ext := range obj.FileExtensions {
			if !fileExtensionPattern.MatchString(ext) {
				return fmt.Sprintf("contributed file extension %q must look like \".ext\" in lowercase", ext)
			}
		}
	}
	return ""
}

// IngestionClaim is one valid plugin's claim on bare-URL pastes as
// the paste chain's wiring consumes it (docs/goals/0251).
type IngestionClaim struct {
	PluginID string
	Kind     string
}

// URLPasteClaims returns the claims of every VALID plugin whose
// manifest sets pastesURLs, in ListPlugins' own deterministic id
// order. Consulted by the paste recognizer chain through the
// composition root's enablement filter -- never by running plugin
// code: a claim only routes the paste; the plugin's JS renders the
// object it produced, later, in the webview.
//
//wails:ignore
func (p *PluginService) URLPasteClaims() []IngestionClaim {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var out []IngestionClaim
	for _, info := range infos {
		if info.Error != "" {
			continue
		}
		for _, obj := range info.Manifest.Contributes.CanvasObjects {
			if obj.PastesURLs {
				out = append(out, IngestionClaim{PluginID: info.Manifest.ID, Kind: obj.Kind})
			}
		}
	}
	return out
}

// GuardedActionDecision is RequestGuardedAction's wire shape.
type GuardedActionDecision struct {
	Approved  bool
	Effect    string
	RuleLabel string
	// Performed is true when Mill executed the approved action itself
	// (the plugin never receives the primitive).
	Performed bool
}

// RequestGuardedAction is the plugin plane's one door to a primitive
// the plugin does not hold (docs/adr/0047 §2). The manifest must
// DECLARE the capability (an undeclared kind is refused here, before
// any rule runs); a declared one is evaluated per-action by the
// guardrail rule core -- allow/deny resolve immediately, ask parks for
// a human and blocks this call until resolved (the same park the MCP
// write plane uses). On approval Mill performs the action itself.
func (p *PluginService) RequestGuardedAction(pluginID string, kind string, attributes map[string]string, description string) (GuardedActionDecision, error) {
	plugin := p.scanOne(pluginID)
	if plugin.Error != "" {
		return GuardedActionDecision{}, fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	declared := false
	for _, c := range plugin.Manifest.Capabilities {
		if c == kind {
			declared = true
			break
		}
	}
	if !declared {
		return GuardedActionDecision{}, fmt.Errorf("plugin %q does not declare the %q capability in its manifest", pluginID, kind)
	}
	decision, err := p.guardrail.RequestGuardedAction(context.Background(), guardrailsvc.GuardedAction{
		Kind:        kind,
		Attributes:  attributes,
		Description: description,
		Source:      "plugin:" + pluginID,
	})
	if err != nil {
		return GuardedActionDecision{}, err
	}
	out := GuardedActionDecision{Approved: decision.Approved, Effect: string(decision.Effect), RuleLabel: decision.RuleLabel}
	if decision.Approved {
		performed, perr := p.perform(kind, attributes)
		if perr != nil {
			return out, perr
		}
		out.Performed = performed
	}
	return out, nil
}

// perform executes an approved action on the plugin's behalf. Each
// capability's execution lives here, next to its vocabulary entry --
// the plugin's request never contained the primitive, only the ask.
func (p *PluginService) perform(kind string, attributes map[string]string) (bool, error) {
	if kind == "open-url" {
		u := attributes["url"]
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			return false, fmt.Errorf("open-url only opens http(s) URLs")
		}
		if err := p.openInOS(u); err != nil {
			return false, fmt.Errorf("open URL: %w", err)
		}
		return true, nil
	}
	return false, nil
}
