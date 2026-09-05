package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/adapters/jsengine"
)

// The secret-source runtime: secrets.js loaded into the same embedded
// engine steps.js runs in, and the confined file doors a source
// function reaches the machine through. The host receives what a
// source read and applies it through the provider path; the plugin
// never sees another source's value, nor any vault entry.

const secretsPackFile = "secrets.js"

// capabilityReadFile is the manifest capability a secret-source plugin
// must declare: its source functions may read the file or folder the
// USER pointed the source at, and nothing else. It grants no write and
// no traversal above that path.
const capabilityReadFile = "read-file"

// sourceReadLimit caps one ctx.readFile: a credential file is small,
// and an unbounded read would let a source pull an arbitrarily large
// file into the engine.
const sourceReadLimit = 4 << 20

// The problem codes SourceProblem answers with for the two states a
// plugin-backed source can be in without its plugin. They are codes,
// not sentences, because the Sources page renders them in the reader's
// own language.
const (
	SourceProblemPluginMissing  = "plugin-not-installed"
	SourceProblemPluginDisabled = "plugin-turned-off"
)

// SecretSourceKindInfo is one plugin-contributed kind as the Sources
// page's Kind picker renders it: the kind string a source stores, the
// option's label and the plugin name beneath it, and how the path
// field renders.
type SecretSourceKindInfo struct {
	Kind            string
	Label           string
	PluginID        string
	PluginName      string
	PathKind        string
	PathLabel       string
	PathPlaceholder string
	PathDefault     string
	CanDiscover     bool
	CanImport       bool
}

// SecretSourceKinds lists every runnable installed plugin's declared
// secret sources, sorted by label -- what the Kind picker offers after
// the built-in kinds. A plugin that may not run, or whose manifest is
// broken, contributes nothing.
func (p *PluginService) SecretSourceKinds() []SecretSourceKindInfo {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	out := []SecretSourceKindInfo{}
	for _, info := range infos {
		if info.Error != "" || len(info.Manifest.Contributes.SecretSources) == 0 {
			continue
		}
		if p.mayRun != nil && !p.mayRun(info.Manifest.ID, info.Builtin) {
			continue
		}
		name := info.Manifest.Name
		if name == "" {
			name = info.Manifest.ID
		}
		for _, src := range info.Manifest.Contributes.SecretSources {
			out = append(out, SecretSourceKindInfo{
				Kind: SecretSourceKind(info.Manifest.ID, src.ID), Label: src.Label,
				PluginID: info.Manifest.ID, PluginName: name,
				PathKind: src.Path.Kind, PathLabel: src.Path.Label,
				PathPlaceholder: src.Path.Placeholder, PathDefault: src.Path.Default,
				CanDiscover: sourceDeclares(src, sourceCapDiscover), CanImport: sourceDeclares(src, sourceCapImport),
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

func sourceDeclares(src SecretSourceContribution, capability string) bool {
	for _, c := range src.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

// SourceProblem reports why a plugin-backed kind cannot answer right
// now ("" when it can): a problem CODE for the two states the reader
// can act on, the loader's own sentence for a broken manifest.
//
//wails:ignore
func (p *PluginService) SourceProblem(kind string) string {
	_, _, err := p.resolveSecretSource(kind)
	if err == nil {
		return ""
	}
	return err.Error()
}

// SourceList lists a plugin-backed source's secret NAMES.
//
//wails:ignore
func (p *PluginService) SourceList(kind, path string) ([]string, error) {
	pack, ctx, err := p.sourceCall(kind, path)
	if err != nil {
		return nil, err
	}
	_, sourceID, _ := splitSecretSourceKind(kind)
	return pack.SourceList(sourceID, ctx)
}

// SourceResolve reads one named secret out of a plugin-backed source.
// The value is returned to the HOST, which applies it through the
// provider path; it is never handed back to plugin code or the webview.
//
//wails:ignore
func (p *PluginService) SourceResolve(kind, path, key string) (string, error) {
	pack, ctx, err := p.sourceCall(kind, path)
	if err != nil {
		return "", err
	}
	_, sourceID, _ := splitSecretSourceKind(kind)
	return pack.SourceResolve(sourceID, ctx, key)
}

// SourceDiscover asks a folder-shaped source what it can find under the
// configured folder. Empty for a source that declares no discovery.
//
//wails:ignore
func (p *PluginService) SourceDiscover(kind, path string) ([]jsengine.Discovered, error) {
	pack, ctx, err := p.sourceCall(kind, path)
	if err != nil {
		return nil, err
	}
	_, sourceID, _ := splitSecretSourceKind(kind)
	return pack.SourceDiscover(sourceID, ctx)
}

// SourceImport reads several of a source's secrets in one call.
//
//wails:ignore
func (p *PluginService) SourceImport(kind, path string, keys []string) (map[string]string, error) {
	pack, ctx, err := p.sourceCall(kind, path)
	if err != nil {
		return nil, err
	}
	_, sourceID, _ := splitSecretSourceKind(kind)
	return pack.SourceImport(sourceID, ctx, keys)
}

// sourceCall is every bridge method's one preamble: resolve the kind to
// a runnable plugin and its declaration, load the pack, and build the
// call context confined to the user's configured path.
func (p *PluginService) sourceCall(kind, path string) (*jsengine.Pack, jsengine.SourceCtx, error) {
	info, decl, err := p.resolveSecretSource(kind)
	if err != nil {
		return nil, jsengine.SourceCtx{}, err
	}
	pack, err := p.secretsPack(info)
	if err != nil {
		return nil, jsengine.SourceCtx{}, err
	}
	return pack, sourceCtx(decl, path), nil
}

// resolveSecretSource maps a kind onto the plugin that answers it,
// refusing every state in which it cannot: an unparseable kind, a
// missing or broken plugin, one the run policy blocks, or a source the
// manifest no longer declares.
func (p *PluginService) resolveSecretSource(kind string) (PluginInfo, SecretSourceContribution, error) {
	pluginID, sourceID, ok := splitSecretSourceKind(kind)
	if !ok {
		return PluginInfo{}, SecretSourceContribution{}, fmt.Errorf("%q is not a plugin secret source", kind)
	}
	info := p.resolvePlugin(pluginID)
	if info.Manifest.ID != pluginID || (info.Error != "" && strings.Contains(info.Error, "manifest.json is missing")) {
		return info, SecretSourceContribution{}, fmt.Errorf("%s", SourceProblemPluginMissing)
	}
	if info.Error != "" {
		return info, SecretSourceContribution{}, fmt.Errorf("%s", info.Error)
	}
	if p.mayRun != nil && !p.mayRun(pluginID, info.Builtin) {
		return info, SecretSourceContribution{}, fmt.Errorf("%s", SourceProblemPluginDisabled)
	}
	for _, src := range info.Manifest.Contributes.SecretSources {
		if src.ID == sourceID {
			return info, src, nil
		}
	}
	return info, SecretSourceContribution{}, fmt.Errorf("%s", SourceProblemPluginMissing)
}

// secretsPack returns the plugin's loaded secrets.js, reloading when
// the file changed -- the steps pack's cache keyed by a distinct id so
// the two packs of one plugin never displace each other.
func (p *PluginService) secretsPack(info PluginInfo) (*jsengine.Pack, error) {
	path := filepath.Join(info.Dir, secretsPackFile)
	st, err := os.Stat(path) // #nosec G304 G703 -- the plugin's own folder
	if err != nil {
		return nil, fmt.Errorf("secrets.js is missing")
	}
	p.packsMu.Lock()
	defer p.packsMu.Unlock()
	if p.packs == nil {
		p.packs = map[string]loadedPack{}
	}
	key := secretsPackFile + ":" + info.Manifest.ID
	if cached, ok := p.packs[key]; ok && cached.size == st.Size() && cached.modTime.Equal(st.ModTime()) {
		return cached.pack, cached.err
	}
	raw, err := os.ReadFile(path) // #nosec G304 -- the plugin's own folder
	if err != nil {
		return nil, err
	}
	pack, err := jsengine.LoadSources(string(raw), jsengine.DefaultTimeout)
	p.packs[key] = loadedPack{size: st.Size(), modTime: st.ModTime(), pack: pack, err: err}
	return pack, err
}

// sourceCtx builds the confined doors one source call gets. A file
// source reads exactly the file the user named; a folder source reads
// and lists under the folder the user named and nowhere else; a source
// with no path gets neither door, and calling one throws inside the
// pack.
func sourceCtx(decl SecretSourceContribution, configured string) jsengine.SourceCtx {
	path := expandHome(configured)
	ctx := jsengine.SourceCtx{Path: path}
	switch decl.Path.Kind {
	case SourcePathFile:
		ctx.ReadFile = func(relative string) (string, error) {
			if strings.TrimSpace(relative) != "" {
				return "", fmt.Errorf("this source reads only the file it is configured with")
			}
			return readSourceFile(path)
		}
	case SourcePathFolder:
		ctx.ReadFile = func(relative string) (string, error) {
			full, err := confinedPath(path, relative)
			if err != nil {
				return "", err
			}
			return readSourceFile(full)
		}
		ctx.ListFiles = func(pattern string) ([]string, error) { return listSourceFiles(path, pattern) }
	}
	return ctx
}

// expandHome resolves a leading "~" against this account's home
// directory: a credential file's conventional address is written that
// way ("~/.netrc"), and a source's default path is offered in that
// form, so the path a source is configured with has to accept it.
func expandHome(path string) string {
	if path != "~" && !strings.HasPrefix(path, "~"+string(filepath.Separator)) {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return filepath.Join(home, strings.TrimPrefix(path, "~"))
}

// confinedPath joins a source-supplied relative path onto the folder
// the user configured and refuses anything that leaves it -- the one
// place a plugin's own string reaches the filesystem.
func confinedPath(root, relative string) (string, error) {
	if strings.TrimSpace(relative) == "" {
		return "", fmt.Errorf("name a file inside the folder to read")
	}
	if filepath.IsAbs(relative) {
		return "", fmt.Errorf("this source reads only inside its own folder")
	}
	cleanRoot := filepath.Clean(root)
	full := filepath.Clean(filepath.Join(cleanRoot, relative))
	if full != cleanRoot && !strings.HasPrefix(full, cleanRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("this source reads only inside its own folder")
	}
	return full, nil
}

func readSourceFile(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("this source has no path yet")
	}
	f, err := os.Open(path) // #nosec G304 -- the path the user configured for this source, or a name confined under it
	if err != nil {
		return "", fmt.Errorf("cannot read %s", filepath.Base(path))
	}
	defer func() { _ = f.Close() }()
	buf := make([]byte, sourceReadLimit)
	n, err := f.Read(buf)
	if n == 0 && err != nil {
		return "", nil
	}
	return string(buf[:n]), nil
}

// listSourceFiles lists the folder's direct children matching a glob
// pattern (an empty pattern lists them all) -- names only, never a
// nested walk, so a source cannot enumerate a whole home directory.
func listSourceFiles(root, pattern string) ([]string, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("this source has no folder yet")
	}
	entries, err := os.ReadDir(root) // #nosec G304 -- the folder the user configured for this source
	if err != nil {
		return nil, fmt.Errorf("cannot read %s", filepath.Base(root))
	}
	out := []string{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if pattern != "" {
			if ok, _ := filepath.Match(pattern, e.Name()); !ok {
				continue
			}
		}
		out = append(out, e.Name())
	}
	sort.Strings(out)
	return out, nil
}
