package dotenvsource

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadAndKeys_FollowDotenvRules(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(p, []byte("# comment\nAPI_TOKEN=\"quoted value\"\nPLAIN=bare\nEXPANDED=${PLAIN}-x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	v, err := Read(p)
	if err != nil {
		t.Fatal(err)
	}
	if v["API_TOKEN"] != "quoted value" || v["PLAIN"] != "bare" || v["EXPANDED"] != "bare-x" {
		t.Errorf("values: %v", v)
	}
	keys, _ := Keys(p)
	if strings.Join(keys, ",") != "API_TOKEN,EXPANDED,PLAIN" {
		t.Errorf("keys: %v", keys)
	}
	if _, err := Read(filepath.Join(t.TempDir(), "missing.env")); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Errorf("missing file: %v", err)
	}
}
