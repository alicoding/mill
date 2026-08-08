//go:build !server

package launchatlogin

import (
	"errors"
	"testing"
)

func TestAppBundlePath(t *testing.T) {
	got, err := appBundlePath("/Applications/Mill.app/Contents/MacOS/mill")
	if err != nil {
		t.Fatalf("appBundlePath: %v", err)
	}
	if want := "/Applications/Mill.app"; got != want {
		t.Errorf("appBundlePath = %q, want %q", got, want)
	}
}

func TestAppBundlePath_DevBinary_ErrNotAppBundle(t *testing.T) {
	_, err := appBundlePath("/Users/ali/code/mill/bin/mill.dev")
	if !errors.Is(err, ErrNotAppBundle) {
		t.Errorf("appBundlePath on a bare dev binary: err = %v, want ErrNotAppBundle", err)
	}
}

func TestAppName(t *testing.T) {
	if got, want := appName("/Applications/Mill.app"), "Mill"; got != want {
		t.Errorf("appName = %q, want %q", got, want)
	}
}
