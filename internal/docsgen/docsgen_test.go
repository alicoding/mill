package docsgen

import (
	"os"
	"path/filepath"
	"testing"
)

// The tfplugindocs shape (goal 0125): generated docs are committed,
// and this test fails the build when the committed files drift from
// what the live registry/tree would generate -- reference docs that
// cannot rot. Fix a failure with `go generate ./internal/docsgen`.
func TestUserDocs_MatchCommitted(t *testing.T) {
	root := filepath.Join("..", "..", "userdocs")
	cases := []struct {
		rel string
		gen func() (string, error)
	}{
		{filepath.Join("reference", "steps.md"), func() (string, error) { return GenerateStepReference(), nil }},
		{"llms.txt", func() (string, error) { return GenerateLLMSTxt(root) }},
		{"llms-full.txt", func() (string, error) { return GenerateLLMSFullTxt(root) }},
	}
	for _, c := range cases {
		want, err := c.gen()
		if err != nil {
			t.Fatalf("%s: generate: %v", c.rel, err)
		}
		got, err := os.ReadFile(filepath.Join(root, c.rel)) // #nosec G304 -- c.rel is this test's own fixed table
		if err != nil {
			t.Fatalf("%s: read committed: %v", c.rel, err)
		}
		if string(got) != want {
			t.Errorf("%s is stale -- run `go generate ./internal/docsgen` and commit the result", c.rel)
		}
	}
}
