package main

import (
	"bufio"
	"io"
	"strings"
	"sync"
)

// tailLines drains stdout+stderr concurrently (an unread pipe fills its
// OS buffer and blocks the child process) and keeps the last max lines
// of each, combined, for a failure report -- same tail-buffer shape
// frontend/e2e/fixtures/server.ts uses for its own spawned server. The
// returned func snapshots the tail under lock, safe to call from a
// different goroutine than the ones draining the pipes.
func tailLines(stdout, stderr io.Reader, max int) func() string {
	var mu sync.Mutex
	lines := make([]string, 0, max)
	add := func(line string) {
		mu.Lock()
		defer mu.Unlock()
		lines = append(lines, line)
		if len(lines) > max {
			lines = lines[len(lines)-max:]
		}
	}
	drain := func(r io.Reader) {
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			add(scanner.Text())
		}
	}
	go drain(stdout)
	go drain(stderr)
	return func() string {
		mu.Lock()
		defer mu.Unlock()
		return strings.Join(lines, "\n")
	}
}
