package configuresvc

import (
	"strings"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// RequestCredentialGap is graph validation's credential-presence seam
// (composition.SetCredentialGapCheck, wired from the composition
// root): missing=true only when the request EXISTS, declares an auth
// type that needs a secret, and names none.
//
// Since every secret is a reference the entity itself carries (goal
// 0306), presence is a field read, not a keychain probe -- which is
// what retired goal 0127 slice 3's presence cache: the read that cache
// existed to amortize (a per-call shell-out to the OS keychain on
// macOS) no longer happens. Unknown ids report no gap
// (validateRequiredRefs' territory): the badge must never cry wolf on
// a state the run would not fail on.
//
//wails:ignore
func (c *ConfigureService) RequestCredentialGap(requestID string) (missing bool, label string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, r := range c.requests {
		if r.ID != requestID {
			continue
		}
		return requestSecretMissing(r), r.Label
	}
	return false, ""
}

// requestSecretMissing reports whether r declares an auth scheme
// needing a secret but names none for it. OAuth 1.0a's token secret is
// optional (RFC 5849's 2-legged flow omits it), so only the consumer
// secret counts here.
func requestSecretMissing(r httprequest.HTTPRequest) bool {
	switch {
	case r.AuthType == httprequest.AuthNone || strings.TrimSpace(string(r.AuthType)) == "":
		return false
	case r.AuthType == httprequest.AuthOAuth1 || r.AuthType == httprequest.AuthOAuth1Vendor:
		return r.Auth == nil || r.Auth.OAuth1 == nil || r.Auth.OAuth1.ConsumerSecretRef == ""
	}
	return r.SecretRef == ""
}

// requestOwnSecretRef names the same field requestSecretMissing checks
// for presence -- the one place both read from, so the two checks can
// never drift on which field an AuthType's secret lives in.
func requestOwnSecretRef(r httprequest.HTTPRequest) string {
	if r.AuthType == httprequest.AuthOAuth1 || r.AuthType == httprequest.AuthOAuth1Vendor {
		if r.Auth == nil || r.Auth.OAuth1 == nil {
			return ""
		}
		return r.Auth.OAuth1.ConsumerSecretRef
	}
	return r.SecretRef
}

// RequestSecretUnresolved is graph validation's unresolved-secret seam
// (composition.SetSecretUnresolvedCheck, goal 0408 S1): unresolved=true
// only when the request EXISTS, names a secret reference, and that
// reference is a source-backed one whose source no longer has the key
// -- an unset reference is validateRequiredRefs' territory, and a
// vault-backed one that no longer exists is a different state
// (secretRefGone) this check does not claim.
//
// The lock is released before calling secretUnresolvedLookup: that
// seam calls back into this service's own SecretSources() (through
// secretsvc's sourcesSnapshot), which would deadlock on c.mu if it
// were still held here.
//
//wails:ignore
func (c *ConfigureService) RequestSecretUnresolved(requestID string) (unresolved bool, key, sourceLabel string) {
	c.mu.Lock()
	var (
		found bool
		r     httprequest.HTTPRequest
	)
	for _, req := range c.requests {
		if req.ID == requestID {
			r, found = req, true
			break
		}
	}
	lookup := c.secretUnresolvedLookup
	c.mu.Unlock()
	if !found || lookup == nil {
		return false, "", ""
	}
	ref := strings.TrimSpace(requestOwnSecretRef(r))
	if ref == "" {
		return false, "", ""
	}
	return lookup(ref)
}
