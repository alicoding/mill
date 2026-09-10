package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommittedIdentityAssets(t *testing.T) {
	root := filepath.Join("..", "..")
	if err := validateAssets(root, false); err != nil {
		t.Fatal(err)
	}
}

func TestCheckModesAreValidationOnly(t *testing.T) {
	for _, options := range []runOptions{
		{check: true},
		{checkPackaged: true},
		{checkIOS: true},
	} {
		if !options.validationOnly() {
			t.Fatalf("check mode %+v would invoke generation", options)
		}
	}
	if (runOptions{}).validationOnly() {
		t.Fatal("generation mode was classified as validation-only")
	}
}

func TestCheckModesDoNotNeedRendererOrMutateSources(t *testing.T) {
	root := filepath.Join("..", "..")
	paths := []string{
		markSource,
		"build/appicon.icon/Assets/mill-mark.svg",
		"build/appicon.png",
	}
	before := make(map[string][]byte, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(filepath.Join(root, path)) // #nosec G304 -- fixed test asset inventory
		if err != nil {
			t.Fatal(err)
		}
		before[path] = data
	}
	t.Setenv("PATH", t.TempDir())
	for _, options := range []runOptions{
		{check: true},
		{checkPackaged: true},
		{checkIOS: true},
	} {
		err := run(root, options)
		if err != nil && (!options.checkIOS || !os.IsNotExist(err)) {
			t.Fatalf("run(%+v) without renderer: %v", options, err)
		}
	}
	for _, path := range paths {
		after, err := os.ReadFile(filepath.Join(root, path)) // #nosec G304 -- fixed test asset inventory
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before[path], after) {
			t.Fatalf("check mode mutated %s", path)
		}
	}
}

func TestIconComposerForegroundMustMatchCanonicalBytes(t *testing.T) {
	root := t.TempDir()
	canonicalPath := filepath.Join(root, markSource)
	composerDir := filepath.Join(root, "build/appicon.icon/Assets")
	if err := os.MkdirAll(filepath.Dir(canonicalPath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(composerDir, 0o750); err != nil {
		t.Fatal(err)
	}
	canonical := []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)
	if err := os.WriteFile(canonicalPath, canonical, 0o600); err != nil {
		t.Fatal(err)
	}
	mutated := append([]byte(nil), canonical...)
	mutated[len(mutated)-2] = 'x'
	if err := os.WriteFile(filepath.Join(composerDir, "mill-mark.svg"), mutated, 0o600); err != nil {
		t.Fatal(err)
	}
	err := validateIconComposer(root)
	if err == nil || !strings.Contains(err.Error(), "differs from canonical") {
		t.Fatalf("validateIconComposer() error = %v, want canonical-byte drift", err)
	}
}
