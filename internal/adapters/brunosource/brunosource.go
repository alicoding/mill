// Package brunosource reads what a Bruno collection says about its own
// secrets (goal 0306 slice 2): the collection's name from bruno.json,
// the dotenv file at the collection root Bruno's documented secrets
// channel points at, and the secret NAMES its environments declare
// (`vars:secret [ … ]` in environments/*.bru) -- names only, never a
// value; Bruno's own encrypted store is private and is never read.
package brunosource

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Collection is what the provider needs to list and resolve.
type Collection struct {
	Dir  string
	Name string
	// EnvPath is <Dir>/.env whether or not it exists yet.
	EnvPath string
	// SecretNames are the names every environment declares as secret,
	// sorted, de-duplicated -- listed even when the .env lacks them, so
	// the picker shows what the collection expects.
	SecretNames []string
}

// Read resolves path (the collection folder, or its bruno.json) into a
// Collection. A folder without a bruno.json is not a collection.
func Read(path string) (Collection, error) {
	dir := strings.TrimSpace(path)
	if strings.HasSuffix(strings.ToLower(dir), "bruno.json") {
		dir = filepath.Dir(dir)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "bruno.json")) // #nosec G304 -- the user's own collection path
	if err != nil {
		return Collection{}, fmt.Errorf("no bruno.json in %s", dir)
	}
	var manifest struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return Collection{}, fmt.Errorf("bruno.json in %s is not valid JSON", dir)
	}
	name := strings.TrimSpace(manifest.Name)
	if name == "" {
		name = filepath.Base(dir)
	}
	return Collection{Dir: dir, Name: name, EnvPath: filepath.Join(dir, ".env"), SecretNames: secretNames(dir)}, nil
}

var secretBlock = regexp.MustCompile(`(?s)vars:secret\s*\[(.*?)\]`)

// secretNames scans environments/*.bru for `vars:secret [ a, b ]`
// blocks; a missing folder is simply no names.
func secretNames(dir string) []string {
	entries, err := os.ReadDir(filepath.Join(dir, "environments"))
	if err != nil {
		return []string{}
	}
	seen := map[string]bool{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".bru") {
			continue
		}
		raw, rerr := os.ReadFile(filepath.Join(dir, "environments", e.Name())) // #nosec G304 -- the collection's own folder
		if rerr != nil {
			continue
		}
		for _, n := range namesInSecretBlocks(string(raw)) {
			seen[n] = true
		}
	}
	out := make([]string, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// namesInSecretBlocks lists the comma- or newline-separated names inside
// every `vars:secret [ … ]` block of one .bru file.
func namesInSecretBlocks(raw string) []string {
	var names []string
	for _, m := range secretBlock.FindAllStringSubmatch(raw, -1) {
		for _, name := range strings.FieldsFunc(m[1], func(r rune) bool { return r == ',' || r == '\n' || r == '\r' }) {
			if n := strings.TrimSpace(name); n != "" {
				names = append(names, n)
			}
		}
	}
	return names
}
