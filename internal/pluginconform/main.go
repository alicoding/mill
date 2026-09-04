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
		dirs, _ = filepath.Glob("examples/plugins/*")
	}
	failed := 0
	for _, dir := range dirs {
		problems := pluginsvc.ConformDir(dir, "")
		warnings := pluginsvc.ConformThemeWarnings(dir)
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
