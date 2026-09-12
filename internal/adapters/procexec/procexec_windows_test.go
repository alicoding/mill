//go:build windows

package procexec

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestStartRefusesUnsupportedPlatformBeforeSpawn(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "spawned")
	started := false
	handle, err := Start(Spec{
		Argv: []string{os.Args[0], "-test.run=TestUnsupportedPlatformProcessHelper", "--", marker},
		Env:  append(os.Environ(), "MILL_PROCEXEC_WINDOWS_HELPER=1"),
		OnStarted: func(int) {
			started = true
		},
	})
	if handle != nil {
		t.Fatalf("Start handle = %v, want nil", handle)
	}
	if !errors.Is(err, ErrUnsupportedPlatform) {
		t.Fatalf("Start error = %v, want ErrUnsupportedPlatform", err)
	}
	if started {
		t.Fatal("OnStarted called")
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatalf("child side effect exists: %v", statErr)
	}
}

func TestUnsupportedPlatformProcessHelper(t *testing.T) {
	if os.Getenv("MILL_PROCEXEC_WINDOWS_HELPER") != "1" {
		return
	}
	args := os.Args
	if len(args) < 2 {
		os.Exit(2)
	}
	if err := os.WriteFile(args[len(args)-1], []byte("spawned"), 0o600); err != nil {
		os.Exit(3)
	}
	os.Exit(0)
}
