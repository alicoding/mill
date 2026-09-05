// Command pluginconform runs the platform contract's conformance
// checks (ADR-0051) over plugin folders: the loader's own manifest
// validation ahead of time, plus the folder rules the loader meets
// only file by file. Usage:
//
//	go run ./internal/pluginconform <plugin-dir> [<plugin-dir>...]
//
// With no arguments it checks every shipped example under
// examples/plugins. Exit status 1 when any folder has a problem.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/services/pluginsvc"
)

func main() {
	dirs := os.Args[1:]
	if len(dirs) == 0 {
		dirs = examplePluginDirs()
	}
	failed := 0
	for _, dir := range dirs {
		problems := pluginsvc.ConformDir(dir, "")
		problems = append(problems, exampleReadmeProblems(dir)...)
		warnings := pluginsvc.ConformThemeWarnings(dir)
		warnings = append(warnings, pluginsvc.ConformStandardWarnings(dir)...)
		if len(problems) == 0 {
			fmt.Printf("PASS  %s\n", dir)
		} else {
			failed++
			fmt.Printf("FAIL  %s\n", dir)
			for _, p := range problems {
				fmt.Printf("      - %s\n", p)
			}
		}
		for _, w := range warnings {
			fmt.Printf("      ! %s\n", w)
		}
	}
	if failed > 0 {
		os.Exit(1)
	}
}

// examplePluginDirs lists every plugin FOLDER under examples/plugins --
// each example's sibling README (rule 15) now lives right next to it
// as a .md file, which the plain glob would otherwise hand to
// ConformDir as if it were a plugin of its own.
func examplePluginDirs() []string {
	entries, err := os.ReadDir("examples/plugins")
	if err != nil {
		return nil
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, filepath.Join("examples/plugins", e.Name()))
		}
	}
	return dirs
}

// exampleReadmeProblems is standard rule 15, checked only for a shipped
// example: its README lives BESIDE the plugin folder, at
// examples/plugins/<id>.md -- a plugin folder may only hold files the
// asset route serves, so the README can never sit inside it.
func exampleReadmeProblems(dir string) []string {
	parent, id := filepath.Split(filepath.Clean(dir))
	if filepath.Base(filepath.Clean(parent)) != "plugins" || filepath.Base(filepath.Dir(filepath.Clean(parent))) != "examples" {
		return nil
	}
	readme := filepath.Join(parent, id+".md")
	if _, err := os.Stat(readme); err != nil {
		return []string{fmt.Sprintf("standard rule 15: missing %s (a README beside the plugin folder)", readme)}
	}
	return nil
}
