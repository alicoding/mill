package composition

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"

	josepkg "github.com/go-jose/go-jose/v4"

	"github.com/alicoding/mill/internal/domain/connector"
)

// defaultJOSEAlgorithm/defaultJOSEContentEncryption are Mill's own
// stated defaults (ADR-0015 Phase 3's research checkpoint), not a
// claimed universal standard: RSA-OAEP-256 (key encryption) + A256GCM
// (content encryption) are both real, supported algorithm identifiers
// confirmed directly against go-jose/v4's own README algorithm tables
// -- a common, defensible pairing (AEAD content cipher, a modern
// RSA-OAEP variant) rather than the older, weaker RSA1_5/AES-CBC+HMAC
// options the same table also lists.
const (
	defaultJOSEAlgorithm         = "RSA-OAEP-256"
	defaultJOSEContentEncryption = "A256GCM"
)

func joseAlgorithm(conf *connector.JOSEConfig) josepkg.KeyAlgorithm {
	if conf.Algorithm != "" {
		return josepkg.KeyAlgorithm(conf.Algorithm)
	}
	return josepkg.KeyAlgorithm(defaultJOSEAlgorithm)
}

func joseContentEncryption(conf *connector.JOSEConfig) josepkg.ContentEncryption {
	if conf.ContentEncryption != "" {
		return josepkg.ContentEncryption(conf.ContentEncryption)
	}
	return josepkg.ContentEncryption(defaultJOSEContentEncryption)
}

// parseRSAPublicKeyPEM accepts either PKIX ("BEGIN PUBLIC KEY") or
// PKCS1 ("BEGIN RSA PUBLIC KEY") PEM encodings -- both are real, common
// formats a user could plausibly paste in from a vendor's own
// documentation, and there's no way to know which one in advance.
func parseRSAPublicKeyPEM(pemStr string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("not a valid PEM block")
	}
	if pub, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		if rsaPub, ok := pub.(*rsa.PublicKey); ok {
			return rsaPub, nil
		}
		return nil, fmt.Errorf("PEM key is not an RSA public key")
	}
	if pub, err := x509.ParsePKCS1PublicKey(block.Bytes); err == nil {
		return pub, nil
	}
	return nil, fmt.Errorf("could not parse as a PKIX or PKCS1 RSA public key")
}

// parseRSAPrivateKeyPEM accepts either PKCS1 ("BEGIN RSA PRIVATE KEY")
// or PKCS8 ("BEGIN PRIVATE KEY") PEM encodings, same reasoning as
// parseRSAPublicKeyPEM above.
func parseRSAPrivateKeyPEM(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("not a valid PEM block")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if rsaKey, ok := key.(*rsa.PrivateKey); ok {
			return rsaKey, nil
		}
		return nil, fmt.Errorf("PEM key is not an RSA private key")
	}
	return nil, fmt.Errorf("could not parse as a PKCS1 or PKCS8 RSA private key")
}

// ApplyJOSEEncryption encrypts body into a JWE compact-serialized
// string when conf enables it -- a no-op (body unchanged) for nil or
// disabled config, so a connector with no JOSE config behaves exactly
// as before this existed (same "strict superset" framing ADR-0007
// Phase 3 already established for Attribute-binding). Called before
// ApplyAuth in integration.go's nodeExec, so a signing AuthType
// (HMAC/OAuth 1.0a) signs the encrypted body actually transmitted, not
// the plaintext underneath it. Exported (like ApplyAuth) so
// configureservice_connectortest.go's TestConnectorOperation (package
// main, ADR-0013's test-the-draft-exactly-as-it-would-run RPC) can
// reuse the identical encryption path a real workflow run goes
// through, not a second, driftable copy.
func ApplyJOSEEncryption(conf *connector.JOSEConfig, body string) (string, error) {
	if conf == nil || !conf.Enabled {
		return body, nil
	}
	pub, err := parseRSAPublicKeyPEM(conf.RecipientPublicKeyPEM)
	if err != nil {
		return "", fmt.Errorf("jose: recipient public key: %w", err)
	}
	encrypter, err := josepkg.NewEncrypter(joseContentEncryption(conf), josepkg.Recipient{Algorithm: joseAlgorithm(conf), Key: pub}, nil)
	if err != nil {
		return "", fmt.Errorf("jose: %w", err)
	}
	obj, err := encrypter.Encrypt([]byte(body))
	if err != nil {
		return "", fmt.Errorf("jose: encrypt: %w", err)
	}
	serialized, err := obj.CompactSerialize()
	if err != nil {
		return "", fmt.Errorf("jose: %w", err)
	}
	return serialized, nil
}

// DecryptJOSEResponse decrypts a JWE compact-serialized response body
// using Mill's own private key -- a no-op (body unchanged) unless conf
// both exists and has DecryptResponse set, matching the reference
// platform's own "optionally decrypts" framing (request encryption is
// unconditional once Enabled; response decryption is a separate,
// independent toggle since not every vendor encrypts its responses
// back). Exported for the same TestConnectorOperation-parity reason as
// ApplyJOSEEncryption above.
func DecryptJOSEResponse(conf *connector.JOSEConfig, privateKeyPEM string, body string) (string, error) {
	if conf == nil || !conf.DecryptResponse {
		return body, nil
	}
	priv, err := parseRSAPrivateKeyPEM(privateKeyPEM)
	if err != nil {
		return "", fmt.Errorf("jose: private key: %w", err)
	}
	obj, err := josepkg.ParseEncrypted(body, []josepkg.KeyAlgorithm{joseAlgorithm(conf)}, []josepkg.ContentEncryption{joseContentEncryption(conf)})
	if err != nil {
		return "", fmt.Errorf("jose: parse response: %w", err)
	}
	plaintext, err := obj.Decrypt(priv)
	if err != nil {
		return "", fmt.Errorf("jose: decrypt response: %w", err)
	}
	return string(plaintext), nil
}
