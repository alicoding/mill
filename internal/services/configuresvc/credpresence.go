package configuresvc

import (
	"errors"
	"strings"
	"sync"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// presenceCachingCredentials decorates the credential store with a
// presence cache (goal 0127 slice 3): graph validation asks "does this
// integration have a credential?" on every save/panel refresh, and a
// raw keychain read shells out per call on macOS -- the cache answers
// after the first read, and stays correct forever because EVERY
// Set/Get/Delete flows through this same decorator (the constructor
// wraps the store once; no call site can bypass it).
type presenceCachingCredentials struct {
	inner   credential.Store
	mu      sync.Mutex
	present map[string]bool
}

func newPresenceCachingCredentials(inner credential.Store) *presenceCachingCredentials {
	return &presenceCachingCredentials{inner: inner, present: map[string]bool{}}
}

func (p *presenceCachingCredentials) remember(id string, has bool) {
	p.mu.Lock()
	p.present[id] = has
	p.mu.Unlock()
}

func (p *presenceCachingCredentials) Set(id, secret string) error {
	err := p.inner.Set(id, secret)
	if err == nil {
		p.remember(id, true)
	}
	return err
}

func (p *presenceCachingCredentials) Get(id string) (string, error) {
	s, err := p.inner.Get(id)
	switch {
	case err == nil:
		p.remember(id, true)
	case errors.Is(err, credential.ErrNotFound):
		p.remember(id, false)
	}
	return s, err
}

func (p *presenceCachingCredentials) Delete(id string) error {
	err := p.inner.Delete(id)
	if err == nil {
		p.remember(id, false)
	}
	return err
}

// has answers from the cache alone; ok=false means never observed.
func (p *presenceCachingCredentials) has(id string) (present, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	present, ok = p.present[id]
	return present, ok
}

// RequestCredentialGap is graph validation's credential-presence seam
// (composition.SetCredentialGapCheck, wired from the composition
// root): missing=true only when the request EXISTS, declares an auth
// type that needs a secret, and the keychain provably has none. Any
// other state -- unknown id (validateRequiredRefs' territory),
// AuthNone, or a transient keychain error -- reports no gap: the
// badge must never cry wolf on states the run wouldn't fail on, and
// a real keychain fault still surfaces through the run's own error
// path.
//
//wails:ignore
func (c *ConfigureService) RequestCredentialGap(requestID string) (missing bool, label string) {
	c.mu.Lock()
	label = ""
	needsSecret := false
	for _, r := range c.requests {
		if r.ID == requestID {
			label = r.Label
			needsSecret = r.AuthType != httprequest.AuthNone && strings.TrimSpace(string(r.AuthType)) != ""
			break
		}
	}
	c.mu.Unlock()
	if label == "" || !needsSecret {
		return false, label
	}
	if cache, isCaching := c.credentials.(*presenceCachingCredentials); isCaching {
		if present, ok := cache.has(requestID); ok {
			return !present, label
		}
	}
	_, err := c.credentials.Get(requestID)
	if errors.Is(err, credential.ErrNotFound) {
		return true, label
	}
	return false, label
}
