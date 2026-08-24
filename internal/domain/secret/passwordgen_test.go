package secret

import (
	"strings"
	"testing"
)

func TestGenerate_Default(t *testing.T) {
	got, err := Generate(DefaultGenerateOptions())
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len(got) != defaultLenth {
		t.Fatalf("length = %d, want %d", len(got), defaultLenth)
	}
}

func TestGenerate_NoCharsetEnabled(t *testing.T) {
	_, err := Generate(GenerateOptions{Length: 10})
	if err == nil {
		t.Fatal("Generate with no character class enabled should fail")
	}
}

func TestGenerate_LengthBounds(t *testing.T) {
	if _, err := Generate(GenerateOptions{Length: 0, Lower: true}); err == nil {
		t.Fatal("Generate with length 0 should fail")
	}
	if _, err := Generate(GenerateOptions{Length: 1000, Lower: true}); err == nil {
		t.Fatal("Generate with length 1000 should fail")
	}
}

func TestGenerate_SymbolsOnlyWhenRequested(t *testing.T) {
	got, err := Generate(GenerateOptions{Length: 40, Lower: true})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if strings.ContainsAny(got, symbolChars) {
		t.Fatalf("Generate without Symbols produced a symbol: %q", got)
	}
}

func TestGenerate_IsRandom(t *testing.T) {
	a, err := Generate(DefaultGenerateOptions())
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	b, err := Generate(DefaultGenerateOptions())
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if a == b {
		t.Fatal("two Generate calls produced the same password -- suspiciously deterministic")
	}
}
