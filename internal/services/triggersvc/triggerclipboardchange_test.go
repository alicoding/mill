package triggersvc

import (
	"errors"
	"testing"
)

func TestShouldCaptureClipboardChange_CapturesOrdinaryChange(t *testing.T) {
	got := shouldCaptureClipboardChange("hello",
		func(string) bool { return false },
		func() (bool, error) { return false, nil },
	)
	if !got {
		t.Error("shouldCaptureClipboardChange() = false for an ordinary, non-concealed, non-self-written change, want true")
	}
}

func TestShouldCaptureClipboardChange_SkipsSelfEcho(t *testing.T) {
	got := shouldCaptureClipboardChange("mill wrote this",
		func(string) bool { return true },
		func() (bool, error) { t.Fatal("isConcealed should not be called once consumeSelfWrite already matched"); return false, nil },
	)
	if got {
		t.Error("shouldCaptureClipboardChange() = true for Mill's own self-write echo, want false")
	}
}

func TestShouldCaptureClipboardChange_SkipsConcealedContent(t *testing.T) {
	got := shouldCaptureClipboardChange("a password",
		func(string) bool { return false },
		func() (bool, error) { return true, nil },
	)
	if got {
		t.Error("shouldCaptureClipboardChange() = true for content marked concealed, want false")
	}
}

// TestShouldCaptureClipboardChange_FailSafeOnConcealedCheckError pins
// node-standard.md item 6: an unevaluable concealed check must count as
// the RESTRICTIVE outcome (skip), never as "assume it's safe."
func TestShouldCaptureClipboardChange_FailSafeOnConcealedCheckError(t *testing.T) {
	got := shouldCaptureClipboardChange("something",
		func(string) bool { return false },
		func() (bool, error) { return false, errors.New("osascript failed") },
	)
	if got {
		t.Error("shouldCaptureClipboardChange() = true when isConcealed() itself errors, want false (fail-safe)")
	}
}
