// Command gen regenerates internal/contract/schemas/*.schema.json from
// every family registered with internal/contract -- run via `go
// generate ./internal/contract` (ADR-0036 decision 1). The blank
// imports below are the only place anything imports every envelope-
// owning service package purely for its init() side effects; nothing
// else in this repo needs to.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/contract"
	_ "github.com/alicoding/mill/internal/services/compositionsvc"
	_ "github.com/alicoding/mill/internal/services/configuresvc"
	_ "github.com/alicoding/mill/internal/services/executionsvc"
)

func main() {
	schemas, err := contract.GenerateAll()
	if err != nil {
		fmt.Fprintln(os.Stderr, "contract gen:", err)
		os.Exit(1)
	}

	const dir = "schemas"
	if err := os.MkdirAll(dir, 0o750); err != nil {
		fmt.Fprintln(os.Stderr, "contract gen: mkdir:", err)
		os.Exit(1)
	}
	for family, data := range schemas {
		path := filepath.Join(dir, family+".schema.json")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			fmt.Fprintln(os.Stderr, "contract gen: write:", path, err)
			os.Exit(1)
		}
	}

	doc, err := contract.GenerateDocument()
	if err != nil {
		fmt.Fprintln(os.Stderr, "contract gen: document:", err)
		os.Exit(1)
	}
	if err := os.WriteFile("contract.json", doc, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "contract gen: write contract.json:", err)
		os.Exit(1)
	}
}
