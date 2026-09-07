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
	"sync"

	"context"
	"encoding/json"
	"fmt"
	"github.com/alicoding/mill/internal/adapters/osopen"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/mod/semver"

	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// Manifest is the converged plugin manifest shape (docs/adr/0047 §1:
// identity metadata + a declared capability set). Rendering
// contributions happen at activate() time through the host API, so
// they are not restated here; INGESTION claims are the deliberate
// exception (docs/goals/0251) -- both ingestion chains must consult
// them without running plugin code, so they live in Contributes.
type Manifest struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Version        string `json:"version"`
	Description    string `json:"description"`
	Author         string `json:"author"`
	MinMillVersion string `json:"minMillVersion"`
	// Icon names this plugin's 128x128 icon file, relative to its own
	// folder (the standard's identity rule -- pluginsvc/conform_standard.go
	// checks it decodes to exactly that size). A sibling file with
	// "@dark" inserted before the extension, when present, is the
	// dark-appearance variant.
	Icon         string              `json:"icon"`
	Capabilities []string            `json:"capabilities"`
	Contributes  ManifestContributes `json:"contributes"`
}

// ManifestContributes is the manifest's declarative contribution
// point (docs/goals/0251, the VSCode-shaped convention): data other
// parts of Mill read to ROUTE to a plugin, distinct from capabilities
// (what a plugin may ask to do).
type ManifestContributes struct {
	CanvasObjects []CanvasObjectContribution `json:"canvasObjects"`
	// Steps (ADR-0051 §5, pluginservice_steps.go): workflow steps the
	// plugin implements in steps.js, declared here so the catalog and
	// the Extensions row know them before any code runs.
	Steps []StepContribution `json:"steps"`
	// Captures (goal 0309, pluginservice_captures.go): quick-capture
	// surfaces the plugin renders in the capture window.
	Captures []CaptureContribution `json:"captures"`
	// Settings (docs/goals/0258 slice 1): the plugin's own declared
	// user settings, the same declare -> host renders/stores/serves
	// contract compiled-in nouns use. Declared in the manifest, not
	// at activate() time, so the Extensions row can render them
	// without running plugin code and validation fails the LOAD.
	Settings []SettingContribution `json:"settings"`
	// Network (docs/goals/0288): the hosts a plugin may fetch from,
	// declared so the Extensions row can state them before the plugin
	// runs and so an undeclared host is refused before any rule. Only
	// meaningful with the "fetch" capability.
	Network []NetworkContribution `json:"network"`
	// Views (docs/goals/0290): the work tabs a plugin may open, declared
	// so the Extensions row can state them before the plugin runs and
	// so activate-time registerView is checked against a declaration.
	Views []ViewContribution `json:"views"`
	// Commands (docs/goals/0324): the palette commands the plugin
	// registers at activate() time. Declaring one is what lets a tool
	// name it; an undeclared registerCommand still works.
	Commands []CommandContribution `json:"commands"`
	// Themes (docs/goals/0342): color themes the plugin ships as CSS
	// data files. Declared here because the picker lists them before
	// any plugin code runs, and a theme needs no code at all.
	Themes []ThemeContribution `json:"themes"`
	// SecretSources (goal 0306 S4, pluginservice_secretsources.go): the
	// stores this plugin can read secrets out of, implemented in
	// secrets.js. Declared here because the Sources page's Kind picker
	// lists them, and their path fields render, before any plugin code
	// runs.
	SecretSources []SecretSourceContribution `json:"secretSources"`
	// Tools (docs/goals/0324): the automation-reachable surface --
	// which of this plugin's commands, steps and reads an agent may
	// call over MCP, each with its own typed input contract.
	Tools []ToolContribution `json:"tools"`
	// MCPServers (docs/goals/0349 S5, pluginservice_mcpservers.go): MCP
	// server definitions the plugin ships for "Add to Configure".
	MCPServers []MCPServerContribution `json:"mcpServers"`
}

// ViewContribution declares one plugin-owned work tab: a slug id
// unique within the plugin and the tab's title. Entry names an .html
// page inside the plugin's own folder (docs/goals/0349): a view that
// declares one is mounted in its own sandboxed frame and needs no
// plugin code at all; a view that leaves it empty is the legacy
// same-DOM form, rendered by the render callback registered at
// activate().
type ViewContribution struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Entry string `json:"entry"`
}

// NetworkContribution names one host (lowercase, optional :port) and
// the HTTP methods a plugin may use against it. An empty Methods means
// GET only -- the read-only default.
type NetworkContribution struct {
	Host    string   `json:"host"`
	Methods []string `json:"methods"`
}

// PluginInfo is one scanned plugin as the Extensions surface and the
// loader see it. Error is a load-blocking validation problem stated
// for the human (the row renders it; the loader skips the plugin) --
// a plugin is either fully valid or visibly broken, never silently
// half-loaded. Builtin marks a plugin embedded in the binary
// (pluginservice_builtin.go): same loader and disable list as any
// plugin, but nothing on disk to reveal or delete.
type PluginInfo struct {
	Manifest Manifest
	Dir      string
	Error    string
	Builtin  bool
	// ContentHash is the folder's current content hash
	// (pluginservice_hash.go), "" for a built-in or an invalid plugin
	// -- what the lock compares against.
	ContentHash string
	// SigningPolicy reports whether an administrator pinned signing
	// keys; Signed whether this folder's signature verified against one
	// (pluginservice_signing.go). Both false with no policy.
	SigningPolicy bool
	Signed        bool
	// Tier is the install trust tier (trust.go, docs/goals/0349): what
	// actually checked these bytes when they landed. "" for a built-in.
	Tier string
	// Marketplace names the index this folder was installed from, ""
	// when it arrived some other way.
	Marketplace string
	// PolicyBlocked is the organisation policy's refusal sentence
	// (policy_match.go), "" when no policy refuses this folder. A
	// refused plugin stays listed and never runs.
	PolicyBlocked string
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
	// open-app (goal 0310): open a local path in a NAMED application
	// (a collection folder in Bruno) -- the OS's own open-with, never a
	// shell; server mode approves without performing, like open-url.
	"open-app": true,
	// list-files (goal 0310): list a folder's direct children through
	// Mill (pluginservice_files.go) -- a read-class action, evaluated
	// and audited, never the plugin's own filesystem access.
	"list-files": true,
	// erase-board-items: a drag-shaped canvas tool may hit-test and
	// erase board items through the host's own quick-delete-with-undo
	// door (goal 0252 S2). Enforced host-side in the webview: the
	// gesture ctx only carries the erase calls when the manifest
	// declares this; the ids of hit items never cross into plugin code.
	"erase-board-items": true,
	// fetch: ask Mill to perform an HTTP request against a host the
	// manifest's contributes.network declares (docs/goals/0288). The
	// request is a guarded action (kind net.fetch) executed host-side
	// with confinement to the declared host on every hop; the plugin
	// receives the response, never a socket.
	"fetch": true,
	// read-file (goal 0306 S4): a secret-source plugin's own
	// secrets.js may read the file, or read and list inside the folder,
	// the USER configured its source with -- nothing above it, nothing
	// else on the machine, and no write. The plugin never holds a file
	// handle; the host reads and hands back the bytes.
	"read-file": true,
	// write-content: create notes and cards and append List rows
	// through the guarded content plane (docs/goals/0289) -- the same
	// guard an agent's write takes, kind content.write.
	"write-content": true,
}

// pluginIDPattern pins ids to a filesystem- and URL-safe slug: the id
// doubles as the plugin's folder name and its asset-route segment, so
// anything outside this set would be a traversal or encoding hazard,
// not a style choice.
var pluginIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// PluginService is Wails-bound. openURL is injected so tests never
// shell out to the real OS handler. appVersion is the build-stamped
// Mill version minMillVersion enforcement compares against.
type PluginService struct {
	dir        string
	guardrail  *guardrailsvc.GuardrailService
	openURL    func(url string) error
	appVersion string
	// content is the guarded content-write seam (docs/goals/0289),
	// nil until the composition root wires it.
	content ContentWriter
	// secretRefs / readSetting are the secretRef door's seams
	// (pluginservice_fetch_secret.go), nil until wired -- a fetch
	// naming a secret then refuses rather than sends unauthenticated.
	secretRefs  SecretRefResolver
	readSetting SettingReader
	// trust / secretAccess are the audit export's read seams
	// (pluginservice_audit.go), nil until wired.
	trust        PluginTrustReader
	secretAccess func(actorPrefix string) ([]PluginSecretAccess, error)
	// mayRun / packs are the step-pack door's policy and cache
	// (pluginservice_steps.go).
	mayRun  func(id string, builtin bool) bool
	packsMu sync.Mutex
	packs   map[string]loadedPack
	// signingKeys is the signed tier's policy source
	// (pluginservice_signing.go), nil until wired.
	signingKeys func() []string
	// runCommand is the command-tool bridge to the webview
	// (pluginservice_toolrun.go), injected so a test never needs a live
	// window.
	runCommand func(pluginID, commandID string) (string, error)
	// examples is the embedded example tree the bundled "mill"
	// marketplace offers (marketplace_examples.go), injected because
	// go:embed paths are package-relative.
	examples fs.FS
	// download is the user-initiated HTTP seam every marketplace and
	// install fetch goes through (marketplace_store.go), nil for the
	// real client -- a test never reaches a host.
	download func(url string, limit int64) ([]byte, error)
}

func New(dir string, guardrail *guardrailsvc.GuardrailService, appVersion string) *PluginService {
	// osopen, not the runtime's Browser API: the adapter's server build
	// is a documented no-op (ErrUnsupportedInServerMode), so an approved
	// open-url in server mode -- every e2e run of the plugin spec --
	// never reaches the machine's real browser. The runtime opener did.
	return &PluginService{dir: dir, guardrail: guardrail, openURL: osopen.Open, appVersion: appVersion, runCommand: invokeCommandInWebview}
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
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read plugins directory: %w", err)
	}
	// A missing plugins dir is normal (nothing installed yet) -- the
	// built-ins below still list.
	infos := make([]PluginInfo, 0, len(entries))
	scanned := map[string]bool{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		infos = append(infos, p.scanOne(e.Name()))
		scanned[e.Name()] = true
	}
	// Built-ins fill in behind the scanned directory: a user folder
	// with the same id shadows its built-in entirely (even an invalid
	// one -- its own error row is the honest state, and deleting the
	// folder restores the built-in).
	for _, id := range builtinPluginIDs() {
		if !scanned[id] {
			infos = append(infos, scanBuiltin(id, p.appVersion))
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Manifest.ID < infos[j].Manifest.ID })
	return infos, nil
}

// resolvePlugin is the by-id lookup every non-list path uses
// (guarded actions, asset serving): the user's own folder first, the
// built-in behind it -- the same shadowing rule ListPlugins applies.
// The pattern gate up front makes the joined path traversal-safe for
// a caller-supplied id (RequestGuardedAction's pluginID arrives
// straight off the wire).
func (p *PluginService) resolvePlugin(id string) PluginInfo {
	if !pluginIDPattern.MatchString(id) {
		return PluginInfo{Manifest: Manifest{ID: id}, Error: "the manifest id must be lowercase letters, digits, and hyphens"}
	}
	if _, err := os.Stat(filepath.Join(p.dir, id)); err == nil { // #nosec G703 -- id passed pluginIDPattern above (no separators, no dots)
		return p.scanOne(id)
	}
	if isBuiltinPluginID(id) {
		return scanBuiltin(id, p.appVersion)
	}
	return p.scanOne(id)
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
	_, mainErr := os.Stat(filepath.Join(dir, "main.js")) // #nosec G703 -- folder passed pluginIDPattern (no separators, no dots)
	info.Error = manifestProblem(m, folder, mainErr == nil, p.appVersion)
	if info.Error == "" {
		info.Error = stepsFileProblem(dir, m)
	}
	if info.Error == "" {
		info.Error = secretsFileProblem(dir, m)
	}
	if info.Error == "" {
		info.Error = entryFileProblem(m, func(rel string) bool {
			_, statErr := os.Stat(filepath.Join(dir, filepath.FromSlash(rel))) // #nosec G703 -- rel passed entryPathProblem (no traversal, no absolute path)
			return statErr == nil
		})
	}
	if info.Error == "" {
		if h, err := ContentHash(dir); err == nil {
			info.ContentHash = h
		}
	}
	if keys := p.signingKeySet(); len(keys) > 0 {
		info.SigningPolicy = true
		info.Signed = SignatureVerified(dir, info.ContentHash, keys)
	}
	info.Tier = InstalledTier(dir, false)
	if rec, ok := ReadInstallRecord(dir); ok {
		info.Marketplace = rec.Marketplace
	}
	p.applyPolicy(&info)
	return info
}

// manifestProblem runs every load-blocking validation shared by the
// scanned-directory and built-in scan paths, returning the first
// human-readable problem or "".
func manifestProblem(m Manifest, folder string, mainJSExists bool, appVersion string) string {
	switch {
	case !pluginIDPattern.MatchString(m.ID):
		return "the manifest id must be lowercase letters, digits, and hyphens"
	case m.ID != folder:
		// The Obsidian convention, adopted deliberately: the folder IS
		// the identity, so a copied folder can never impersonate a
		// different plugin's id.
		return fmt.Sprintf("the manifest id %q must match the folder name %q", m.ID, folder)
	case strings.TrimSpace(m.Name) == "" || strings.TrimSpace(m.Version) == "":
		return "the manifest needs a name and a version"
	case !mainJSExists:
		return "main.js is missing"
	}
	for _, c := range m.Capabilities {
		if !knownCapabilities[c] {
			// Fail-closed: an unknown capability blocks the LOAD,
			// never silently narrows to the known set -- the user
			// sees exactly why the plugin won't run.
			return fmt.Sprintf("unknown capability %q", c)
		}
	}
	if problem := validateContributes(m.ID, m.Capabilities, m.Contributes); problem != "" {
		return problem
	}
	return checkMinMillVersion(m.MinMillVersion, appVersion)
}

// checkMinMillVersion refuses a plugin that declares it needs a newer
// Mill (the converged app-plugin convention: plugins version against
// the APP's version, never a separate API number -- docs/goals/0245's
// stability contract). The app's prerelease/build tags are stripped
// before comparing: a beta is stamped against the NEXT release
// (main.go's build-stamp trio documents exactly this), so plain
// semver would rank it below that release's minimum forever. A
// malformed minimum fails closed like any other manifest error; an
// unparseable app version (an unstamped source build) skips
// enforcement rather than refusing every version-pinned plugin.
func checkMinMillVersion(minVersion, appVersion string) string {
	if strings.TrimSpace(minVersion) == "" {
		return ""
	}
	minV := "v" + strings.TrimPrefix(minVersion, "v")
	if !semver.IsValid(minV) {
		return fmt.Sprintf("the manifest minMillVersion %q must be a version like \"1.2.3\"", minVersion)
	}
	appV := "v" + strings.TrimPrefix(appVersion, "v")
	if !semver.IsValid(appV) {
		return ""
	}
	appV = strings.TrimSuffix(appV, semver.Build(appV))
	appV = strings.TrimSuffix(appV, semver.Prerelease(appV))
	if semver.Compare(appV, minV) < 0 {
		return fmt.Sprintf("needs Mill %s or newer -- this is Mill %s", minVersion, appVersion)
	}
	return ""
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
	plugin := p.resolvePlugin(pluginID)
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
