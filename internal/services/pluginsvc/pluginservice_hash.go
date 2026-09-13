package pluginsvc

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// The content hash (ADR-0051 §4, slice 5's lockfile): one SHA-256 over
// a plugin folder's files -- each served file's relative path and
// bytes, in path order; hidden entries and dependency folders skipped,
// like the conformance walk. The trust moment (Allow, or the one-shot
// grandfathering) records it; every later scan compares, so a plugin
// whose files changed after the user allowed it stops running until
// it is reviewed again (trust on first use, the known_hosts shape).
// Cached per folder behind a stat fingerprint (paths, sizes, mtimes)
// so the frequent scans never re-read unchanged files.

type hashEntry struct {
	fingerprint string
	hash        string
}

var (
	hashCacheMu sync.Mutex
	hashCache   = map[string]hashEntry{}
)

// ContentHash returns "sha256-<hex>" for dir, or an error naming the
// unreadable file. Covers manifest.json -- this is the signing/tier
// hash, which must cover every byte a signature vouches for.
func ContentHash(dir string) (string, error) {
	return hashPluginFiles(dir, "content", nil)
}

// CodeHash is ContentHash with manifest.json excluded (docs/goals/0375
// S2): the trust lock's OWN comparison basis, so a manifest-only edit
// -- narrowing a capability, or an unrelated field -- never trips it;
// only widenedFrom's capability-shape diff governs a manifest edit.
// An edit to any OTHER file (main.js, an asset, steps.js) still
// changes this hash exactly as ContentHash would, so the ADR-0051 §4
// slice-5 tamper lock keeps its bite for code, just not for the
// manifest's own declared reach.
func CodeHash(dir string) (string, error) {
	return hashPluginFiles(dir, "code", func(rel string) bool { return rel != "manifest.json" })
}

// hashPluginFiles is ContentHash and CodeHash's shared core: walk,
// filter, hash, cache -- kind namespaces the two caches so they never
// collide on the same folder.
func hashPluginFiles(dir, kind string, include func(rel string) bool) (string, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	cacheKey := kind + ":" + root
	files, fingerprint, err := walkPluginFiles(root)
	if err != nil {
		return "", err
	}
	if include != nil {
		kept := files[:0]
		for _, rel := range files {
			if include(rel) {
				kept = append(kept, rel)
			}
		}
		files = kept
	}
	hashCacheMu.Lock()
	cached, ok := hashCache[cacheKey]
	hashCacheMu.Unlock()
	if ok && cached.fingerprint == fingerprint {
		return cached.hash, nil
	}
	h := sha256.New()
	for _, rel := range files {
		_, _ = io.WriteString(h, rel)
		_, _ = h.Write([]byte{0})
		f, err := os.Open(filepath.Join(root, rel)) // #nosec G304 -- the plugin's own folder, walked above
		if err != nil {
			return "", fmt.Errorf("read %s: %w", rel, err)
		}
		_, copyErr := io.Copy(h, f)
		_ = f.Close()
		if copyErr != nil {
			return "", fmt.Errorf("read %s: %w", rel, copyErr)
		}
		_, _ = h.Write([]byte{0})
	}
	sum := "sha256-" + hex.EncodeToString(h.Sum(nil))
	hashCacheMu.Lock()
	hashCache[cacheKey] = hashEntry{fingerprint: fingerprint, hash: sum}
	hashCacheMu.Unlock()
	return sum, nil
}

// walkPluginFiles lists the folder's hashed files (sorted, relative)
// and a cheap fingerprint of their stat data.
func walkPluginFiles(root string) (files []string, fingerprint string, err error) {
	var fp strings.Builder
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		rel, _ := filepath.Rel(root, path)
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			return skipDirIfHidden(d)
		}
		if !hashedFile(rel, d) {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return ierr
		}
		files = append(files, filepath.ToSlash(rel))
		fmt.Fprintf(&fp, "%s|%d|%d\n", rel, info.Size(), info.ModTime().UnixNano())
		return nil
	})
	if walkErr != nil {
		return nil, "", walkErr
	}
	sort.Strings(files)
	return files, fp.String(), nil
}

func skipDirIfHidden(d fs.DirEntry) error {
	if strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules" {
		return filepath.SkipDir
	}
	return nil
}

// hashedFile: regular, not hidden, not a symlink, and not the
// top-level signature file (which signs the hash, so it cannot be in
// it).
func hashedFile(rel string, d fs.DirEntry) bool {
	if strings.HasPrefix(d.Name(), ".") || d.Type()&fs.ModeSymlink != 0 {
		return false
	}
	return d.Name() != SignatureFile || filepath.Dir(rel) != "."
}

// ContentHashOf answers the current hash of an installed plugin by id
// ("" for a built-in or an unreadable folder) -- the signing/tier
// comparison input.
func (p *PluginService) ContentHashOf(id string) string {
	info := p.resolvePlugin(id)
	if info.Error != "" || info.Builtin || info.Dir == "" {
		return ""
	}
	h, err := ContentHash(info.Dir)
	if err != nil {
		return ""
	}
	return h
}

// CodeHashOf answers the current CodeHash of an installed plugin by id
// ("" for a built-in or an unreadable folder) -- the trust lock's own
// comparison input (docs/goals/0375 S2).
func (p *PluginService) CodeHashOf(id string) string {
	info := p.resolvePlugin(id)
	if info.Error != "" || info.Builtin || info.Dir == "" {
		return ""
	}
	h, err := CodeHash(info.Dir)
	if err != nil {
		return ""
	}
	return h
}

// VersionOf answers an installed plugin's manifest version ("" when
// unknown) -- recorded beside the hash in the lock.
func (p *PluginService) VersionOf(id string) string {
	info := p.resolvePlugin(id)
	if info.Error != "" {
		return ""
	}
	return info.Manifest.Version
}
