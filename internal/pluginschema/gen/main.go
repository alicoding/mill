// Command gen writes the plugin manifest schema published with the SDK.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/pluginschema"
)

func main() {
	data, err := pluginschema.Generate()
	if err != nil {
		fmt.Fprintln(os.Stderr, "plugin schema gen:", err)
		os.Exit(1)
	}
	path := filepath.Join("..", "..", "frontend", "plugin-sdk", "manifest.schema.json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "plugin schema gen: write:", err)
		os.Exit(1)
	}
}
