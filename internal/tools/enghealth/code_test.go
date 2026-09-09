package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFilesNearLOCCap(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "scripts", "loc-policy.json"),
		`{"limit": 100, "exclude_regex": "^generated/"}`)

	near := filepath.Join(root, "near.go")
	over := filepath.Join(root, "over.go")
	excluded := filepath.Join(root, "generated", "big.go")
	mustWrite(t, near, repeatLines(60))  // within 50 of 100
	mustWrite(t, over, repeatLines(200)) // past the cap entirely, not "near"
	mustWrite(t, excluded, repeatLines(60))

	orig := listTrackedFiles
	defer func() { listTrackedFiles = orig }()
	listTrackedFiles = func(string) ([]string, error) {
		return []string{"near.go", "over.go", "generated/big.go"}, nil
	}

	n, ok := FilesNearLOCCap(root)
	if !ok {
		t.Fatal("expected data")
	}
	if n != 1 {
		t.Fatalf("got %d files near the cap, want 1 (near.go only)", n)
	}
}

func TestFilesNearLOCCap_MissingPolicy(t *testing.T) {
	root := t.TempDir()
	if _, ok := FilesNearLOCCap(root); ok {
		t.Fatal("expected no data when loc-policy.json is absent")
	}
}

func TestCheckScriptCount(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "scripts", "check-loc.sh"), "#!/bin/sh\n")
	mustWrite(t, filepath.Join(root, "scripts", "check-comment-hygiene.sh"), "#!/bin/sh\n")
	mustWrite(t, filepath.Join(root, "scripts", "not-a-check.sh"), "#!/bin/sh\n")

	n, ok := CheckScriptCount(root)
	if !ok || n != 2 {
		t.Fatalf("got %d, %v; want 2, true", n, ok)
	}
}

func TestGolangciOffenders(t *testing.T) {
	r := GolangciReport{Issues: []GolangciIssue{
		{FromLinter: "gocognit"},
		{FromLinter: "govet"},
		{FromLinter: "gocognit"},
	}}
	if n := GolangciOffenders(r, "gocognit"); n != 2 {
		t.Fatalf("got %d, want 2", n)
	}
}

func TestESLintSonarjsOffenders(t *testing.T) {
	files := []ESLintFileResult{
		{Messages: []ESLintMessage{{RuleID: "sonarjs/cognitive-complexity"}, {RuleID: "other-rule"}}},
		{Messages: []ESLintMessage{{RuleID: "sonarjs/no-duplicated-branches"}}},
	}
	if n := ESLintSonarjsOffenders(files); n != 2 {
		t.Fatalf("got %d, want 2", n)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func repeatLines(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += "x\n"
	}
	return s
}
