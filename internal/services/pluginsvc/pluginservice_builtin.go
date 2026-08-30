package pluginsvc

import (
	"embed"
	"encoding/json"
	"io/fs"
	"path"
	"sort"
	"strings"
)

// Built-in plugins (goal 0252 S2): real runtime plugins -- the same
// manifest/ESM-module shape a user drops into the plugins directory --
// embedded in the binary so they are present in every mode with no
// install step (the converged built-in-extensions model: the platform
// ships some extensions, the loader treats them like any other). A
// user folder with the same id shadows a built-in entirely, which is
// what makes one replaceable; disabling one rides the same
// disabled-extensions list as any plugin.
//
//go:embed builtin
var builtinPluginsFS embed.FS

const builtinRoot = "builtin"

// builtinPluginIDs lists the embedded plugin folders, sorted for the
// same deterministic order ListPlugins already guarantees.
func builtinPluginIDs() []string {
	entries, err := builtinPluginsFS.ReadDir(builtinRoot)
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			ids = append(ids, e.Name())
		}
	}
	sort.Strings(ids)
	return ids
}

func isBuiltinPluginID(id string) bool {
	if !pluginIDPattern.MatchString(id) {
		return false
	}
	info, err := fs.Stat(builtinPluginsFS, path.Join(builtinRoot, id))
	return err == nil && info.IsDir()
}

// scanBuiltin mirrors scanOne over the embedded bundle: the same
// manifest validation, so a built-in that rotted at build time is
// visibly broken in Extensions rather than silently absent.
func scanBuiltin(id string, appVersion string) PluginInfo {
	info := PluginInfo{Builtin: true, Manifest: Manifest{ID: id}}
	raw, err := builtinPluginsFS.ReadFile(path.Join(builtinRoot, id, "manifest.json"))
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
	_, mainErr := fs.Stat(builtinPluginsFS, path.Join(builtinRoot, id, "main.js"))
	info.Error = manifestProblem(m, id, mainErr == nil, appVersion)
	return info
}

// readBuiltinAsset serves one embedded plugin file. The id has passed
// pluginIDPattern and the file's extension the caller's allowlist;
// the cleaned path must still sit inside the plugin's own embedded
// folder (the embed-FS twin of readAsset's filepath.Rel guard).
func readBuiltinAsset(id, file string) ([]byte, bool) {
	full := path.Join(builtinRoot, id, file)
	if !strings.HasPrefix(full, builtinRoot+"/"+id+"/") {
		return nil, false
	}
	data, err := builtinPluginsFS.ReadFile(full)
	if err != nil {
		return nil, false
	}
	return data, true
}
