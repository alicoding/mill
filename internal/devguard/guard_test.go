package main

import (
	"strings"
	"testing"
)

func TestParseProcesses(t *testing.T) {
	t.Run("parses well-formed lines", func(t *testing.T) {
		output := "  123 wails3 dev -config ./build/config.yml -port 9245\n456 /bin/zsh -c echo hi\n"
		procs := parseProcesses(output)
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

	it := "skips blank lines and a line with no valid integer PID, without failing the whole scan"
	t.Run(it, func(t *testing.T) {
		output := "\n   \nnotapid some command\n789 real process\n"
		procs := parseProcesses(output)
		if len(procs) != 1 || procs[0].pid != 789 {
			t.Fatalf("expected exactly the one valid-PID line, got %+v", procs)
		}
	})

	t.Run("a bare PID with no command still parses, with an empty command", func(t *testing.T) {
		procs := parseProcesses("42\n")
		if len(procs) != 1 || procs[0].pid != 42 || procs[0].command != "" {
			t.Fatalf("unexpected result: %+v", procs)
		}
	})

	t.Run("empty input parses to zero processes", func(t *testing.T) {
		if procs := parseProcesses(""); len(procs) != 0 {
			t.Fatalf("expected zero processes, got %+v", procs)
		}
	})
}

func TestFindWailsDevProcess(t *testing.T) {
	t.Run("matches this repo's own wails3 dev invocation", func(t *testing.T) {
		procs := []process{
			{pid: 1, command: "/bin/zsh -c some unrelated thing"},
			{pid: 2, command: "wails3 dev -config ./build/config.yml -port 9245"},
		}
		found := findWailsDevProcess(procs, 999)
		if found == nil || found.pid != 2 {
			t.Fatalf("expected to find PID 2, got %+v", found)
		}
	})

	t.Run("requires the -config marker too -- a bare 'wails3 build'/'wails3 task run' never matches", func(t *testing.T) {
		procs := []process{
			{pid: 1, command: "wails3 build DEV=true"},
			{pid: 2, command: "wails3 task run"},
		}
		if found := findWailsDevProcess(procs, 999); found != nil {
			t.Fatalf("expected no match, got %+v", found)
		}
	})

	t.Run("an unrelated project's own wails3 dev (different config path) never false-positives", func(t *testing.T) {
		procs := []process{
			{pid: 1, command: "wails3 dev -config ./other-project/build/config.yml -port 5173"},
		}
		if found := findWailsDevProcess(procs, 999); found != nil {
			t.Fatalf("expected no match across a different config path, got %+v", found)
		}
	})

	t.Run("excludes selfPID even if it happened to match (defensive)", func(t *testing.T) {
		procs := []process{
			{pid: 42, command: "wails3 dev -config ./build/config.yml -port 9245"},
		}
		if found := findWailsDevProcess(procs, 42); found != nil {
			t.Fatalf("expected selfPID to be excluded, got %+v", found)
		}
	})

	t.Run("returns nil when nothing is running", func(t *testing.T) {
		if found := findWailsDevProcess(nil, 999); found != nil {
			t.Fatalf("expected nil, got %+v", found)
		}
	})
}

func TestParsePIDList(t *testing.T) {
	t.Run("parses one PID per line", func(t *testing.T) {
		pids := parsePIDList("111\n222\n")
		if len(pids) != 2 || pids[0] != 111 || pids[1] != 222 {
			t.Fatalf("unexpected result: %+v", pids)
		}
	})

	t.Run("empty output (nothing bound to the port) parses to zero PIDs", func(t *testing.T) {
		if pids := parsePIDList(""); len(pids) != 0 {
			t.Fatalf("expected zero PIDs, got %+v", pids)
		}
	})

	t.Run("skips a malformed line rather than failing the whole scan", func(t *testing.T) {
		pids := parsePIDList("333\nnotapid\n444\n")
		if len(pids) != 2 || pids[0] != 333 || pids[1] != 444 {
			t.Fatalf("unexpected result: %+v", pids)
		}
	})
}

func TestBlockedMessage(t *testing.T) {
	t.Run("names the conflicting PID", func(t *testing.T) {
		msg := blockedMessage(&process{pid: 282, command: "wails3 dev -config ./build/config.yml -port 9245"}, nil, 9245)
		if !strings.Contains(msg, "PID 282") {
			t.Errorf("expected message to name PID 282, got: %s", msg)
		}
	})

	t.Run("includes the port PIDs as corroborating detail when present", func(t *testing.T) {
		msg := blockedMessage(&process{pid: 282}, []int{111, 222}, 9245)
		if !strings.Contains(msg, "111, 222") {
			t.Errorf("expected message to list port PIDs, got: %s", msg)
		}
		if !strings.Contains(msg, "9245") {
			t.Errorf("expected message to name the port, got: %s", msg)
		}
	})

	t.Run("omits the port line entirely when nothing else is bound to it", func(t *testing.T) {
		msg := blockedMessage(&process{pid: 282}, nil, 9245)
		if strings.Contains(msg, "also bound") {
			t.Errorf("expected no port line when portPIDs is empty, got: %s", msg)
		}
	})
}
