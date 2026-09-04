package configuresvc

import (
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// resolveHTTPRequest's own secret sub-steps -- split into their own
// file (goal 0203 S3) once extracting them out of resolveHTTPRequest
// itself (to pay its cognitive complexity back under this repo's own
// gate, gocognit @ 15) pushed configureservice_requestauth.go past the
// 500-line limit (scripts/check-loc.sh). Same *ConfigureService
// receiver, same file-per-concern organization that file's own header
// comment already establishes.
//
// Every value here comes from a reference the request NAMES (goal
// 0306): nothing secret is stored on the request, its export or its
// backup, and every read passes the secret store's own controls.

// Field names as a reader sees them in an error, matching the labels
// the request form puts above each picker.
const (
	fieldSecret         = "secret"
	fieldConsumerSecret = "consumer secret"
	fieldTokenSecret    = "token secret"
	fieldPrivateKey     = "private key"
	fieldPublicKey      = "public key"
	fieldAIProviderKey  = "API key"
)

// resolveHTTPRequestSecret resolves whatever secret req's AuthType
// needs. AuthNone needs none. AuthOAuth1 needs two, which the strategy
// consumes through composition's own single-slot encoding
// (EncodeOAuth1Secret, ADR-0015 3) -- so the two references are
// resolved here and joined, leaving the strategy unchanged.
func (c *ConfigureService) resolveHTTPRequestSecret(req httprequest.HTTPRequest, actx secretaudit.AccessContext) (string, error) {
	switch req.AuthType {
	case httprequest.AuthNone, "":
		// An unsaved draft may leave AuthType blank, which Validate
		// would reject but means the same thing here as AuthNone:
		// nothing to resolve.
		return "", nil
	case httprequest.AuthOAuth1, httprequest.AuthOAuth1Vendor:
		return c.resolveOAuth1Secrets(req, actx)
	}
	return c.resolveSecretRef(req.Label, fieldSecret, req.SecretRef, actx)
}

// resolveOAuth1Secrets resolves OAuth 1.0a's consumer secret and its
// optional token secret. RFC 5849's 2-legged flow omits the token, so
// the token secret is optional; the consumer secret never is.
func (c *ConfigureService) resolveOAuth1Secrets(req httprequest.HTTPRequest, actx secretaudit.AccessContext) (string, error) {
	var conf httprequest.OAuth1Config
	if req.Auth != nil && req.Auth.OAuth1 != nil {
		conf = *req.Auth.OAuth1
	}
	consumerSecret, err := c.resolveSecretRef(req.Label, fieldConsumerSecret, conf.ConsumerSecretRef, actx)
	if err != nil {
		return "", err
	}
	tokenSecret, err := c.resolveOptionalSecretRef(req.Label, fieldTokenSecret, conf.TokenSecretRef, actx)
	if err != nil {
		return "", err
	}
	return composition.EncodeOAuth1Secret(consumerSecret, tokenSecret), nil
}

// resolveHTTPRequestJOSEKeys resolves JOSE's two key references: the
// vendor's public key (needed whenever encryption is on) and Mill's own
// private key (needed only when responses are decrypted). A public key
// is not a secret, but it travels the same door so there is one place a
// key is managed and rotated.
func (c *ConfigureService) resolveHTTPRequestJOSEKeys(req httprequest.HTTPRequest, actx secretaudit.AccessContext) (publicKeyPEM, privateKeyPEM string, err error) {
	jose := req.JOSE
	if jose == nil || !jose.Enabled {
		return "", "", nil
	}
	publicKeyPEM, err = c.resolveSecretRef(req.Label, fieldPublicKey, jose.RecipientPublicKeyRef, actx)
	if err != nil {
		return "", "", err
	}
	if !jose.DecryptResponse {
		return publicKeyPEM, "", nil
	}
	privateKeyPEM, err = c.resolveSecretRef(req.Label, fieldPrivateKey, jose.PrivateKeyRef, actx)
	if err != nil {
		return "", "", err
	}
	return publicKeyPEM, privateKeyPEM, nil
}
