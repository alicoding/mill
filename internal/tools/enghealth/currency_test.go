package main

import "testing"

func TestMinorsBehind_SameMajor(t *testing.T) {
	n, ok := MinorsBehind("1.26.8", "1.27.1")
	if !ok || n != 1 {
		t.Fatalf("got %v, %v; want 1, true", n, ok)
	}
}

func TestMinorsBehind_UpToDate(t *testing.T) {
	n, ok := MinorsBehind("1.27.1", "1.27.1")
	if !ok || n != 0 {
		t.Fatalf("got %v, %v; want 0, true", n, ok)
	}
}

func TestMinorsBehind_MajorGapReadsFarBehind(t *testing.T) {
	n, ok := MinorsBehind("1.27.1", "2.0.0")
	if !ok || n < 100 {
		t.Fatalf("got %v, %v; want a large positive lag", n, ok)
	}
}

func TestMinorsBehind_Malformed(t *testing.T) {
	if _, ok := MinorsBehind("not-a-version", "1.27.1"); ok {
		t.Fatal("expected no data for a malformed version string")
	}
}

func TestBetasBehind_Basic(t *testing.T) {
	n, ok := BetasBehind("v3.0.0-beta.12", "v3.0.0-beta.15")
	if !ok || n != 3 {
		t.Fatalf("got %v, %v; want 3, true", n, ok)
	}
}

func TestBetasBehind_NoBetaSuffix(t *testing.T) {
	if _, ok := BetasBehind("v3.0.0", "v3.0.0-beta.15"); ok {
		t.Fatal("expected no data when pinned carries no beta ordinal")
	}
}
