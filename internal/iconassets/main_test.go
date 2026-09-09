package main

import (
	"path/filepath"
	"testing"
)

func TestCommittedIdentityAssets(t *testing.T) {
	root := filepath.Join("..", "..")
	if err := validateAssets(root, false); err != nil {
		t.Fatal(err)
	}
}
