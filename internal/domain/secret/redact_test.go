package secret

import "testing"

func TestRedact_ReplacesKnownSecret(t *testing.T) {
	got := Redact([]string{"hunter2-fake"}, "auth failed for token hunter2-fake")
	want := "auth failed for token [redacted]"
	if got != want {
		t.Fatalf("Redact = %q, want %q", got, want)
	}
}

func TestRedact_MultipleOccurrences(t *testing.T) {
	got := Redact([]string{"s3cr3t-fake"}, "s3cr3t-fake and s3cr3t-fake again")
	if got != "[redacted] and [redacted] again" {
		t.Fatalf("Redact = %q", got)
	}
}

func TestRedact_LongestFirst_NoPartialLeak(t *testing.T) {
	// If "abc" were replaced before "abcdef", the output would contain
	// the leaked "def" tail from the longer secret -- pin the fix.
	got := Redact([]string{"abc", "abcdef"}, "value is abcdef")
	if got != "value is [redacted]" {
		t.Fatalf("Redact = %q, want no leaked remainder", got)
	}
}

func TestRedact_EmptySecretsIgnored(t *testing.T) {
	got := Redact([]string{"", "real-fake"}, "value is real-fake")
	if got != "value is [redacted]" {
		t.Fatalf("Redact = %q", got)
	}
}

func TestRedact_NoMatch_Unchanged(t *testing.T) {
	got := Redact([]string{"nope-fake"}, "nothing to see here")
	if got != "nothing to see here" {
		t.Fatalf("Redact = %q, want unchanged text", got)
	}
}
