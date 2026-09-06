package osopen

import "sync"

// memoryCap bounds Memory's own retained history -- a spec only ever
// needs the last URL a click produced, capped rather than unbounded so
// a long-running e2e worker's recorder never grows forever.
const memoryCap = 20

// Memory is an in-memory stand-in for the real OS opener: OpenURL
// records the request instead of ever shelling out. New's default Port
// for a `go test` binary and for any e2e server spawned with
// MILL_OPEN=memory (goal 0356 part 2) -- a test or a headless e2e run
// must never open a real browser tab on the machine running it.
type Memory struct {
	mu   sync.Mutex
	urls []string
}

// NewMemory returns an empty in-memory opener.
func NewMemory() *Memory { return &Memory{} }

// OpenURL records url as requested, without ever opening anything.
func (m *Memory) OpenURL(url string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.urls = append(m.urls, url)
	if len(m.urls) > memoryCap {
		m.urls = m.urls[len(m.urls)-memoryCap:]
	}
	return nil
}

// OpenedURLs returns every URL recorded so far, oldest first, capped at
// memoryCap.
func (m *Memory) OpenedURLs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.urls))
	copy(out, m.urls)
	return out
}
