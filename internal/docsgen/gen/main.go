// Writes the generated user-docs artifacts (step reference, llms.txt,
// llms-full.txt) into userdocs/ -- run via `go generate
// ./internal/docsgen`; TestUserDocs_MatchCommitted keeps the committed
// output honest.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/docsgen"
)

func main() {
	root := filepath.Join("..", "..", "userdocs")
	if err := os.WriteFile(filepath.Join(root, "reference", "steps.md"), []byte(docsgen.GenerateStepReference()), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for name, gen := range map[string]func(string) (string, error){
		"llms.txt":      docsgen.GenerateLLMSTxt,
		"llms-full.txt": docsgen.GenerateLLMSFullTxt,
	} {
		out, err := gen(root)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte(out), 0o600); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}
