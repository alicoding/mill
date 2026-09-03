package vaultref

import "testing"

func TestParse_VaultStaysBare_ProvidersStayQualified(t *testing.T) {
	if id, ok := Parse("vault:abc"); !ok || id != "abc" {
		t.Errorf("vault ref: %q %v", id, ok)
	}
	if id, ok := Parse("env:src/KEY"); !ok || id != "env:src/KEY" {
		t.Errorf("env ref: %q %v", id, ok)
	}
	for _, v := range []string{"plain", "http://x", "vault:", "op:secret"} {
		if _, ok := Parse(v); ok {
			t.Errorf("%q must not parse as a reference", v)
		}
	}
	if p, id, ok := Split("env:src/KEY"); !ok || p != "env" || id != "src/KEY" {
		t.Errorf("Split: %q %q %v", p, id, ok)
	}
	if Ref("env", "s/K") != "env:s/K" {
		t.Error("Ref")
	}
}
