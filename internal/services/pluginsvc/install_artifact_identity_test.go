package pluginsvc

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCompleteArtifactIdentitySeparatesFileBoundaries(t *testing.T) {
	one := t.TempDir()
	two := t.TempDir()
	writeArtifactFile(t, one, "a.txt", "Xb.txt\x00384\x00Y")
	writeArtifactFile(t, two, "a.txt", "X")
	writeArtifactFile(t, two, "b.txt", "Y")
	if artifactIdentityForTest(t, one) == artifactIdentityForTest(t, two) {
		t.Fatal("one file and two files shared a complete artifact identity")
	}
}

func TestCompleteArtifactIdentityCoversNamesEmptyDirectoriesAndIgnoredRuntimeFiles(t *testing.T) {
	root := t.TempDir()
	writeArtifactFile(t, root, "a.txt", "same")
	initial := artifactIdentityForTest(t, root)
	if err := os.Rename(filepath.Join(root, "a.txt"), filepath.Join(root, "b.txt")); err != nil {
		t.Fatal(err)
	}
	renamed := artifactIdentityForTest(t, root)
	if renamed == initial {
		t.Fatal("filename change did not change artifact identity")
	}
	if err := os.Mkdir(filepath.Join(root, "empty"), 0o750); err != nil {
		t.Fatal(err)
	}
	withDirectory := artifactIdentityForTest(t, root)
	if withDirectory == renamed {
		t.Fatal("empty-directory change did not change artifact identity")
	}
	writeArtifactFile(t, root, ".hidden", "evidence")
	withHidden := artifactIdentityForTest(t, root)
	if withHidden == withDirectory {
		t.Fatal("hidden-file change did not change artifact identity")
	}
	writeArtifactFile(t, root, "node_modules/dependency.js", "dependency")
	if artifactIdentityForTest(t, root) == withHidden {
		t.Fatal("dependency-file change did not change artifact identity")
	}
}

func TestCompleteArtifactIdentityDoesNotUseStatCache(t *testing.T) {
	root := t.TempDir()
	writeArtifactFile(t, root, "main.js", "AAAA")
	path := filepath.Join(root, "main.js")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	legacyBefore, err := ContentHash(root)
	if err != nil {
		t.Fatal(err)
	}
	identityBefore := artifactIdentityForTest(t, root)
	if err := os.WriteFile(path, []byte("BBBB"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	legacyAfter, err := ContentHash(root)
	if err != nil {
		t.Fatal(err)
	}
	if legacyAfter != legacyBefore {
		t.Fatal("test setup did not restore the legacy stat fingerprint")
	}
	if artifactIdentityForTest(t, root) == identityBefore {
		t.Fatal("same-size edit with restored mtime was not observed")
	}
}

func TestCompleteArtifactIdentityCoversSanitizedExecutableProperty(t *testing.T) {
	root := t.TempDir()
	writeArtifactFile(t, root, "server", "fixture")
	plain := artifactIdentityForTest(t, root)
	if err := os.Chmod(filepath.Join(root, "server"), 0o700); err != nil { // #nosec G302 -- executable metadata is the property under test
		t.Fatal(err)
	}
	executable := artifactIdentityForTest(t, root)
	if runtime.GOOS == "windows" {
		if executable != plain {
			t.Fatal("Unix execute metadata changed the Windows artifact identity")
		}
	} else if executable == plain {
		t.Fatal("sanitized executable property did not change artifact identity")
	}
}

func TestCompleteArtifactIdentityHonorsCancellationAndByteLimit(t *testing.T) {
	root := t.TempDir()
	writeArtifactFile(t, root, "main.js", "fixture")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := completeArtifactIdentity(ctx, root); err == nil {
		t.Fatal("cancelled identity completed")
	}
	remaining := int64(1)
	path := filepath.Join(root, "main.js")
	file, err := os.Open(path) // #nosec G304 -- test-owned path
	if err != nil {
		t.Fatal(err)
	}
	initial, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	var closeErr error
	reader := &boundedArtifactReader{ctx: context.Background(), file: file, initial: initial, remaining: &remaining, closeErr: &closeErr}
	if _, err := bytes.NewBuffer(nil).ReadFrom(reader); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("bounded read error = %v", err)
	}
	_ = reader.Close()
}

func TestCompleteArtifactIdentityRefusesSymlinksBeforeReading(t *testing.T) {
	root := t.TempDir()
	writeArtifactFile(t, root, "target", "fixture")
	if err := os.Symlink("target", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := completeArtifactIdentity(context.Background(), root); err == nil {
		t.Fatal("symlink entered a complete artifact identity")
	}
}

func TestArchiveEntryLimitCountsEmptyEntriesBeforeExtraction(t *testing.T) {
	archive := zipWithEmptyEntries(t, maxPackageEntries)
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateArchiveIndex(zr.File); err != nil {
		t.Fatalf("exact entry limit refused: %v", err)
	}
	archive = zipWithEmptyEntries(t, maxPackageEntries+1)
	zr, err = zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateArchiveIndex(zr.File); err == nil || err.Error() != tooManyPackageEntries {
		t.Fatalf("over-limit error = %v", err)
	}
}

func TestPortablePackagePathsRefuseCrossPlatformAliases(t *testing.T) {
	for _, name := range []string{"../x", "/x", `C:\\x`, `folder\\x`, "x.", "x ", "CON", "aux.txt", "line\nfeed"} {
		if _, _, err := portableArchivePath(name); err == nil {
			t.Errorf("portableArchivePath(%q) succeeded", name)
		}
	}
	index := newPortablePathIndex()
	if err := index.add("Folder/file", false); err != nil {
		t.Fatal(err)
	}
	if err := index.add("folder/FILE", false); err == nil {
		t.Fatal("case-aliased duplicate succeeded")
	}
	index = newPortablePathIndex()
	if err := index.add("folder/file", false); err != nil {
		t.Fatal(err)
	}
	if err := index.add("folder", false); err == nil {
		t.Fatal("file-directory collision succeeded")
	}
}

func artifactIdentityForTest(t *testing.T, root string) string {
	t.Helper()
	identity, err := completeArtifactIdentity(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

func writeArtifactFile(t *testing.T, root, name, body string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
}

func zipWithEmptyEntries(t *testing.T, count int) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for index := 0; index < count; index++ {
		if _, err := writer.Create(fmt.Sprintf("f%05d", index)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
