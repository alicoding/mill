package main

import (
	"strings"
	"testing"
)

func TestParsePSOutput(t *testing.T) {
	t.Run("parses well-formed lines", func(t *testing.T) {
		output := "  123 wails3 dev -config ./build/config.yml -port 9245\n456 /bin/zsh -c echo hi\n"
		procs := parsePSOutput(output)
		if len(procs) != 2 {
			t.Fatalf("expected 2 processes, got %d", len(procs))
		}
		if procs[0].pid != 123 || procs[0].command != "wails3 dev -config ./build/config.yml -port 9245" {
			t.Errorf("unexpected first process: %+v", procs[0])
		}
		if procs[1].pid != 456 || procs[1].command != "/bin/zsh -c echo hi" {
			t.Errorf("unexpected second process: %+v", procs[1])
		}
	})

	t.Run("skips blank lines and a line with no valid integer PID", func(t *testing.T) {
		procs := parsePSOutput("\n   \nnotapid some command\n789 real process\n")
		if len(procs) != 1 || procs[0].pid != 789 {
			t.Fatalf("expected exactly the one valid-PID line, got %+v", procs)
		}
	})

	t.Run("empty input parses to zero processes", func(t *testing.T) {
		if procs := parsePSOutput(""); len(procs) != 0 {
			t.Fatalf("expected zero processes, got %+v", procs)
		}
	})
}

func TestFindConflictingProcess(t *testing.T) {
	t.Run("matches this repo's own task dev invocation", func(t *testing.T) {
		procs := []process{
			{pid: 1, command: "/bin/zsh -c some unrelated thing"},
			{pid: 2, command: "wails3 dev -config ./build/config.yml -port 9245"},
		}
		proc, reason, found := findConflictingProcess(procs)
		if !found || proc.pid != 2 {
			t.Fatalf("expected to find PID 2, got proc=%+v found=%v", proc, found)
		}
		if !strings.Contains(reason, "task dev is already running") {
			t.Errorf("unexpected reason: %s", reason)
		}
	})

	t.Run("matches the installed Mill.app", func(t *testing.T) {
		procs := []process{
			{pid: 7, command: "/Applications/Mill.app/Contents/MacOS/mill"},
		}
		proc, reason, found := findConflictingProcess(procs)
		if !found || proc.pid != 7 {
			t.Fatalf("expected to find PID 7, got proc=%+v found=%v", proc, found)
		}
		if !strings.Contains(reason, "installed Mill.app is already running") {
			t.Errorf("unexpected reason: %s", reason)
		}
	})

	t.Run("an unrelated project's own wails3 dev (different config path) never false-positives", func(t *testing.T) {
		procs := []process{
			{pid: 1, command: "wails3 dev -config ./other-project/build/config.yml -port 5173"},
		}
		if _, _, found := findConflictingProcess(procs); found {
			t.Fatal("expected no match across a different config path")
		}
	})

	t.Run("a bare 'wails3 build' never matches", func(t *testing.T) {
		procs := []process{{pid: 1, command: "wails3 build DEV=true"}}
		if _, _, found := findConflictingProcess(procs); found {
			t.Fatal("expected no match")
		}
	})

	t.Run("returns found=false when nothing conflicts", func(t *testing.T) {
		if _, _, found := findConflictingProcess(nil); found {
			t.Fatal("expected found=false for an empty process list")
		}
	})
}
