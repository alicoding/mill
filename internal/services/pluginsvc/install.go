package pluginsvc

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Install mechanics (docs/goals/0349): getting a plugin's files onto
// disk safely. Every path here ends the same way -- a folder under the
// plugins directory named for the manifest's own id, so the existing
// folder-is-the-identity rule (pluginservice.go's manifestProblem)
// keeps holding for anything installed from a link.
//
// Nothing in this file reaches the network; the callers hand it bytes
// or a folder. That split is what lets the extraction and copy rules
// be tested without a server.

// maxArchiveBytes caps what an extraction will write, so a malicious
// or broken archive cannot fill the disk.
const (
	maxArchiveBytes   = 200 << 20
	maxPackageEntries = 65_536
)

// SHA256Hex is the bare hex digest of an archive's bytes -- what a
// marketplace entry's `sha256` declares and what an install compares
// against before writing anything.
func SHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// ExtractZip writes a zip's contents into dest. Every entry must
// resolve INSIDE dest (a "../" entry, an absolute name, or a symlink
// refuses the whole archive rather than skipping the entry -- a
// half-extracted plugin is not a safer outcome than none).
//
// A zip whose files all sit under one top-level folder -- what GitHub's
// own branch and release archives produce -- is unwrapped by that one
// level, so the manifest lands at the root of dest either way.
func ExtractZip(data []byte, dest string) error {
	return ExtractZipContext(context.Background(), data, dest)
}

func ExtractZipContext(ctx context.Context, data []byte, dest string) error {
	zr, err := zip.NewReader(newByteReaderAt(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("that download is not a zip archive")
	}
	prefix, err := validateArchiveIndex(zr.File)
	if err != nil {
		return err
	}
	var written int64
	for _, f := range zr.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := extractZipEntry(ctx, f, prefix, dest, maxArchiveBytes-written)
		if err != nil {
			return err
		}
		written += n
	}
	return nil
}

// extractZipEntry writes one entry, refusing anything that would land
// outside root. A directory entry writes no bytes.
//
// dest is computed once, guarded immediately against the join, and is
// the ONLY path used in every filesystem call below (including the
// directory-entry MkdirAll) -- static analysis for zip-slip requires
// this exact shape (a bare `!strings.HasPrefix(dest, ...)` guard, no
// compound condition) to credit the check as a sanitizer at all, same
// pattern for every downstream write reached through dest.
func extractZipEntry(ctx context.Context, f *zip.File, prefix, root string, budget int64) (int64, error) {
	name := strings.TrimPrefix(filepath.ToSlash(f.Name), prefix)
	if name == "" {
		return 0, nil
	}
	cleanRoot := filepath.Clean(root)
	dest := filepath.Join(cleanRoot, filepath.FromSlash(name))
	if !strings.HasPrefix(dest, cleanRoot+string(os.PathSeparator)) {
		return 0, errOutsideFolder
	}
	if f.Mode()&os.ModeSymlink != 0 {
		return 0, fmt.Errorf("that archive contains a symbolic link, so Mill won't install it")
	}
	if strings.HasSuffix(name, "/") {
		return 0, os.MkdirAll(dest, 0o750)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
		return 0, err
	}
	return copyZipEntry(ctx, f, dest, budget)
}

func copyZipEntry(ctx context.Context, f *zip.File, target string, budget int64) (int64, error) {
	rc, err := f.Open()
	if err != nil {
		return 0, fmt.Errorf("read %s from the archive", f.Name)
	}
	defer func() { _ = rc.Close() }()
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, sanitizedFileMode(f.Mode())) // #nosec G304 -- target passed safeJoin above
	if err != nil {
		return 0, err
	}
	n, copyErr := io.Copy(out, io.LimitReader(&contextReader{ctx: ctx, reader: rc}, budget+1))
	closeErr := out.Close()
	if copyErr != nil {
		return n, copyErr
	}
	if closeErr != nil {
		return n, closeErr
	}
	if n > budget {
		return n, fmt.Errorf("that archive is too large to install")
	}
	if err := os.Chmod(target, sanitizedFileMode(f.Mode())); err != nil {
		return n, err
	}
	return n, nil
}

// errOutsideFolder is the one refusal every traversal check answers
// with: the whole archive or folder is rejected, never the single
// entry, because a half-written plugin is not a safer outcome.
var errOutsideFolder = errors.New("that archive tries to write outside its own folder, so Mill won't install it")

// safeJoin resolves rel under root and refuses anything that escapes
// it -- the one traversal guard both the zip extractor and the folder
// copy go through.
//
// Two checks, deliberately: the entry's own cleaned form may not be
// absolute or carry a ".." segment, AND the joined path must still
// start with root. The second is redundant given the first, and is
// what makes the guard legible to static analysis as a zip-slip
// sanitizer rather than only to a reader.
func safeJoin(root, rel string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(rel))
	if filepath.IsAbs(cleaned) {
		return "", errOutsideFolder
	}
	for _, segment := range strings.Split(cleaned, string(filepath.Separator)) {
		if segment == ".." {
			return "", errOutsideFolder
		}
	}
	base := filepath.Clean(root)
	target := filepath.Clean(filepath.Join(base, cleaned))
	if target != base && !strings.HasPrefix(target, base+string(filepath.Separator)) {
		return "", errOutsideFolder
	}
	return target, nil
}

// commonZipPrefix answers the single top-level folder every entry
// shares ("mill-thing-1.2.0/"), or "" when the archive has more than
// one root.
func commonZipPrefix(files []*zip.File) string {
	prefix := ""
	for _, f := range files {
		name := filepath.ToSlash(f.Name)
		root, _, found := strings.Cut(name, "/")
		if !found || root == "" {
			return ""
		}
		if prefix == "" {
			prefix = root + "/"
			continue
		}
		if prefix != root+"/" {
			return ""
		}
	}
	return prefix
}

// byteReaderAt adapts a byte slice to io.ReaderAt without a temp file.
type byteReaderAt struct{ data []byte }

func newByteReaderAt(data []byte) *byteReaderAt { return &byteReaderAt{data: data} }

func (b *byteReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 || off >= int64(len(b.data)) {
		return 0, io.EOF
	}
	n := copy(p, b.data[off:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

// CopyPluginFolder copies a plugin folder verbatim, skipping the same
// entries the content hash skips (hidden files, node_modules) and
// refusing symlinks -- a copied folder must be exactly what a
// downloaded one would be.
//
// The source stays behind one os.Root handle from planning through
// copying, so a symlink change cannot redirect a later read outside it.
func CopyPluginFolder(src, dest string) error {
	return CopyPluginFolderContext(context.Background(), src, dest)
}

func CopyPluginFolderContext(ctx context.Context, src, dest string) error {
	root, err := os.OpenRoot(src)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	return copyPluginFolderFSContext(ctx, root.FS(), dest)
}

func copyPluginFolderFSContext(ctx context.Context, source fs.FS, dest string) error {
	entries, err := planFolderCopy(ctx, source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dest, 0o750); err != nil {
		return err
	}
	var written int64
	for _, entry := range entries {
		n, err := copyFolderEntry(ctx, source, dest, entry, maxArchiveBytes-written)
		if err != nil {
			return err
		}
		written += n
	}
	return nil
}

func copyFolderEntry(ctx context.Context, source fs.FS, dest string, entry folderCopyEntry, budget int64) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	target, err := safeJoin(dest, entry.rel)
	if err != nil {
		return 0, err
	}
	if entry.directory {
		return 0, os.MkdirAll(target, 0o750)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return 0, err
	}
	return copyFSFile(ctx, source, entry.rel, target, entry.mode, budget)
}

// planFolderCopy lists the relative paths a copy will write, refusing
// the whole folder when it carries a symlink.
func planFolderCopy(ctx context.Context, root fs.FS) ([]folderCopyEntry, error) {
	var entries []folderCopyEntry
	index := newPortablePathIndex()
	err := fs.WalkDir(root, ".", func(entryPath string, d fs.DirEntry, werr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if werr != nil {
			return werr
		}
		entry, include, err := plannedFolderEntry(entryPath, d, index)
		if err != nil {
			return err
		}
		if !include {
			return nil
		}
		entries = append(entries, entry)
		return entryLimitError(len(entries))
	})
	return entries, err
}

func plannedFolderEntry(entryPath string, entry fs.DirEntry, index *portablePathIndex) (folderCopyEntry, bool, error) {
	if entry.IsDir() {
		if entryPath == "." {
			return folderCopyEntry{}, false, nil
		}
		if skipped := skipDirIfHidden(entry); skipped != nil {
			return folderCopyEntry{}, false, skipped
		}
		if err := index.add(filepath.ToSlash(entryPath), true); err != nil {
			return folderCopyEntry{}, false, err
		}
		return folderCopyEntry{rel: entryPath, directory: true}, true, nil
	}
	if strings.HasPrefix(entry.Name(), ".") {
		return folderCopyEntry{}, false, nil
	}
	if entry.Type()&fs.ModeSymlink != 0 {
		return folderCopyEntry{}, false, fmt.Errorf("that folder contains a symbolic link, so Mill won't install it")
	}
	info, err := entry.Info()
	if err != nil {
		return folderCopyEntry{}, false, err
	}
	if !info.Mode().IsRegular() {
		return folderCopyEntry{}, false, fmt.Errorf("that folder contains an unsupported special file, so Mill won't install it")
	}
	if err := index.add(filepath.ToSlash(entryPath), false); err != nil {
		return folderCopyEntry{}, false, err
	}
	return folderCopyEntry{rel: entryPath, mode: info.Mode()}, true, nil
}

func copyFSFile(ctx context.Context, source fs.FS, src, dest string, sourceMode fs.FileMode, budget int64) (int64, error) {
	in, err := source.Open(filepath.ToSlash(src))
	if err != nil {
		return 0, err
	}
	defer func() { _ = in.Close() }()
	mode := sanitizedFileMode(sourceMode)
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode) // #nosec G304 -- dest passed safeJoin
	if err != nil {
		return 0, err
	}
	n, copyErr := io.Copy(out, io.LimitReader(&contextReader{ctx: ctx, reader: in}, budget+1))
	closeErr := out.Close()
	if copyErr != nil {
		return n, copyErr
	}
	if closeErr != nil {
		return n, closeErr
	}
	if n > budget {
		return n, fmt.Errorf("that folder is too large to install")
	}
	if err := os.Chmod(dest, mode); err != nil {
		return n, err
	}
	return n, nil
}

// CopyEmbeddedPlugin copies one folder out of an embedded filesystem
// (the examples Mill ships) into dest. Same plan-then-write order as
// CopyPluginFolder, for the same reason.
func CopyEmbeddedPlugin(fsys fs.FS, root, dest string) error {
	var files []string
	err := fs.WalkDir(fsys, root, func(p string, d fs.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		if !d.IsDir() {
			files = append(files, p)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dest, 0o750); err != nil {
		return err
	}
	for _, p := range files {
		rel := strings.TrimPrefix(strings.TrimPrefix(p, root), "/")
		target, joinErr := safeJoin(dest, rel)
		if joinErr != nil {
			return joinErr
		}
		data, readErr := fs.ReadFile(fsys, p)
		if readErr != nil {
			return readErr
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(target, data, 0o600); err != nil {
			return err
		}
	}
	return nil
}

// ManifestIDIn reads the plugin id out of a staged folder. The
// manifest may sit at the root or one level down (an archive whose
// entries did not share a single prefix), so both are checked -- the
// returned folder is where the plugin's files actually start.
func ManifestIDIn(dir string) (id string, root string, err error) {
	if m, ok := readManifestID(dir); ok {
		return m, dir, nil
	}
	entries, readErr := os.ReadDir(dir)
	if readErr != nil {
		return "", "", fmt.Errorf("that download has no manifest.json")
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(dir, e.Name())
		if m, ok := readManifestID(sub); ok {
			return m, sub, nil
		}
	}
	return "", "", fmt.Errorf("that download has no manifest.json")
}

func readManifestID(dir string) (string, bool) {
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json")) // #nosec G304 -- a staged temp folder this process just wrote
	if err != nil {
		return "", false
	}
	var m struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", false
	}
	found := strings.TrimSpace(m.ID)
	if !pluginIDPattern.MatchString(found) {
		return "", false
	}
	return found, true
}

// ReleaseAssetName is the archive a release publishes for one plugin
// version -- the standard's own naming rule, so Mill can find the
// asset without an API call per release.
func ReleaseAssetName(id, version string) string {
	return id + "-" + strings.TrimPrefix(version, "v") + ".zip"
}

// embeddedPluginPath joins an embedded marketplace root with a plugin
// folder, keeping the forward-slash shape embed.FS requires.
func embeddedPluginPath(root, id string) string { return path.Join(root, id) }
