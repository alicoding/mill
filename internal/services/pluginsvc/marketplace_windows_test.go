//go:build windows

package pluginsvc

import (
	"path/filepath"
	"testing"
)

func TestClassifySource_WindowsAbsoluteFolders(t *testing.T) {
	for name, input := range map[string]string{
		"drive": `C:\Users\someone\store`,
		"UNC":   `\\server\share\store`,
	} {
		t.Run(name, func(t *testing.T) {
			got, err := ClassifySource(input)
			if err != nil {
				t.Fatal(err)
			}
			if got.Kind != "path" || got.Locator != filepath.Clean(input) {
				t.Fatalf("ClassifySource(%q) = %+v", input, got)
			}
		})
	}
}

func TestClassifySource_RefusesAWindowsDriveRelativePath(t *testing.T) {
	if _, err := ClassifySource(`C:store`); err == nil {
		t.Fatal("ClassifySource accepted a drive-relative path")
	}
}
