//go:build !server

package idletime

import (
	"testing"
	"time"
)

// sampleIOReg is the shape of a real `ioreg -c IOHIDSystem` invocation
// (field order/surrounding keys trimmed to what parseIdleTime actually
// reads, but genuinely the format macOS emits: quoted-key = value,
// nanoseconds) -- proves the parse against a real capture rather than
// an invented format.
const sampleIOReg = `+-o IOHIDSystem  <class IOHIDSystem, id 0x100000275, registered, matched, active, busy 0 (0 ms), retain 6>
    {
      "IOClass" = "IOHIDSystem"
      "IOProbeScore" = 0
      "CFBundleIdentifier" = "com.apple.iokit.IOHIDFamily"
      "HIDIdleTime" = 5810802916
      "IOProviderClass" = "IOResources"
    }
`

func TestParseIdleTime_RealSample(t *testing.T) {
	got, err := parseIdleTime(sampleIOReg)
	if err != nil {
		t.Fatalf("parseIdleTime: %v", err)
	}
	want := time.Duration(5810802916)
	if got != want {
		t.Errorf("parseIdleTime = %v, want %v", got, want)
	}
	if secs := got.Seconds(); secs < 5.8 || secs > 5.9 {
		t.Errorf("got.Seconds() = %v, want ~5.81s", secs)
	}
}

func TestParseIdleTime_ZeroIdle(t *testing.T) {
	got, err := parseIdleTime(`      "HIDIdleTime" = 0` + "\n")
	if err != nil {
		t.Fatalf("parseIdleTime: %v", err)
	}
	if got != 0 {
		t.Errorf("parseIdleTime = %v, want 0", got)
	}
}

func TestParseIdleTime_MissingKey_Errors(t *testing.T) {
	if _, err := parseIdleTime(`{"IOClass" = "IOHIDSystem"}`); err == nil {
		t.Error("parseIdleTime with no HIDIdleTime key returned nil error, want an error")
	}
}

func TestParseIdleTime_MalformedValue_Errors(t *testing.T) {
	if _, err := parseIdleTime(`"HIDIdleTime" = not-a-number` + "\n"); err == nil {
		t.Error("parseIdleTime with a non-numeric value returned nil error, want an error")
	}
}
