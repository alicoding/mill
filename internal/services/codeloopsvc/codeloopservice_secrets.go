package codeloopsvc

import (
	"sync"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/google/uuid"
)

// typedSecretsStore is the coding loop's own in-memory-only home for a
// secret the user typed at Confirm (goal 0240 S2's third chain source):
// deliberately NEVER backed by disk, a settings store, or the execution
// database -- the whole point of "type it" is that the value is used
// for this one run and forgotten. Stash writes under a fresh token;
// Take pops (deletes) a single var's value on read, so a value is
// readable exactly once, and an entry's own map empties out (and is
// removed entirely) once every var it held has been consumed.
type typedSecretsStore struct {
	mu      *sync.Mutex
	entries map[string]typedSecretsEntry
}

type typedSecretsEntry struct {
	values    map[string]string
	stashedAt time.Time
}

func newTypedSecretsStore() typedSecretsStore {
	return typedSecretsStore{mu: &sync.Mutex{}, entries: make(map[string]typedSecretsEntry)}
}

// Stash records secrets under a fresh, single-use token and returns it.
// Also sweeps any entry older than composition.TypedSecretsTokenTTL --
// an abandoned Confirm screen (typed, then cancelled) leaves its own
// entry to be swept by the NEXT stash call rather than needing a
// dedicated background goroutine for what's already a rare, small leak
// (this file's own doc comment).
func (s typedSecretsStore) Stash(secrets map[string]string) string {
	token := uuid.NewString()
	values := make(map[string]string, len(secrets))
	for k, v := range secrets {
		values[k] = v
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-composition.TypedSecretsTokenTTL)
	for t, e := range s.entries {
		if e.stashedAt.Before(cutoff) {
			delete(s.entries, t)
		}
	}
	s.entries[token] = typedSecretsEntry{values: values, stashedAt: time.Now()}
	return token
}

// Take pops varName's value out of token's entry -- readable exactly
// once. Returns ("", false) for an unknown token/var (an expired/swept
// entry, a var the user never typed, or every caller's default when no
// typed secrets exist for this run at all: token == "").
func (s typedSecretsStore) Take(token, varName string) (string, bool) {
	if token == "" {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[token]
	if !ok {
		return "", false
	}
	value, ok := entry.values[varName]
	if !ok {
		return "", false
	}
	delete(entry.values, varName)
	if len(entry.values) == 0 {
		delete(s.entries, token)
	}
	return value, true
}
