package mcpaudit

import (
	"context"
	"strings"
	"testing"
)

func TestWithCallerIdentity_RoundTrips(t *testing.T) {
	ctx := WithCallerIdentity(context.Background(), "agentloop-sess-1")
	if got := CallerIdentityFromContext(ctx); got != "agentloop-sess-1" {
		t.Fatalf("CallerIdentityFromContext = %q, want %q", got, "agentloop-sess-1")
	}
}

func TestCallerIdentityFromContext_EmptyWhenUnset(t *testing.T) {
	if got := CallerIdentityFromContext(context.Background()); got != "" {
		t.Fatalf("CallerIdentityFromContext on a bare context = %q, want empty", got)
	}
}

func TestParkedPendingText_RoundTripsThroughParse(t *testing.T) {
	text := ParkedPendingText("write-abc-123")
	id, ok := ParseParkedWriteID(text)
	if !ok || id != "write-abc-123" {
		t.Fatalf("ParseParkedWriteID(%q) = (%q, %v), want (write-abc-123, true)", text, id, ok)
	}
}

func TestParseParkedWriteID_RejectsUnrelatedText(t *testing.T) {
	if _, ok := ParseParkedWriteID("the tool ran fine"); ok {
		t.Fatalf("ParseParkedWriteID matched ordinary tool text, want no match")
	}
}

func TestTruncateError_CapsAtErrorTextCap(t *testing.T) {
	long := strings.Repeat("x", ErrorTextCap+500)
	got := TruncateError(long)
	if len(got) != ErrorTextCap {
		t.Fatalf("len(TruncateError(long)) = %d, want %d", len(got), ErrorTextCap)
	}
}

func TestTruncateError_LeavesShortTextUntouched(t *testing.T) {
	short := "boom"
	if got := TruncateError(short); got != short {
		t.Fatalf("TruncateError(%q) = %q, want unchanged", short, got)
	}
}
