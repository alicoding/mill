package vaultref

import "testing"

func TestParse_VaultReference_ExtractsID(t *testing.T) {
	id, ok := Parse("vault:entry-1")
	if !ok {
		t.Fatal("Parse(\"vault:entry-1\") ok = false, want true")
	}
	if id != "entry-1" {
		t.Errorf("Parse(\"vault:entry-1\") id = %q, want %q", id, "entry-1")
	}
}

func TestParse_PlainValue_NotAReference(t *testing.T) {
	if _, ok := Parse("plain-value"); ok {
		t.Error("Parse(\"plain-value\") ok = true, want false")
	}
}

func TestParse_EmptyValue_NotAReference(t *testing.T) {
	if _, ok := Parse(""); ok {
		t.Error(`Parse("") ok = true, want false`)
	}
}

// Regression: a vault entry id that itself contains a colon (a slug
// like "prod:db") must survive intact -- CutPrefix only strips the
// leading "vault:" once, never touching the rest of the string.
func TestParse_IDContainingColon_PreservedWhole(t *testing.T) {
	id, ok := Parse("vault:prod:db")
	if !ok {
		t.Fatal("Parse(\"vault:prod:db\") ok = false, want true")
	}
	if id != "prod:db" {
		t.Errorf("Parse(\"vault:prod:db\") id = %q, want %q", id, "prod:db")
	}
}
