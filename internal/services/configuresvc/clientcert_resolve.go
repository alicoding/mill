package configuresvc

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/certmaterial"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/clientcert"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// Resolving a client certificate goes through the same vault path
// every other secret does (secretref.go's strict resolvers): the
// material is read at the moment of use, each read writes its own
// audit line, and a locked vault surfaces as this call's error rather
// than a silently certificate-less request. Nothing decrypted is kept
// here; the only thing that outlives one call is the transport
// httpconnector builds, keyed by the revision this resolver reports.

func clientCertNotFound(id string) error {
	return fmt.Errorf("no client certificate with id %q", id)
}

// ErrTestNeedsExactHost: a wildcard entity names a family of hosts,
// none of which is a thing to connect to.
var ErrTestNeedsExactHost = usererror.New("client-cert-wildcard-test", "Testing needs one exact host, not a wildcard.")

// revisionOf identifies one entity's current content for the transport
// cache: a write stamps UpdatedAt, so a changed certificate is a
// different key and never reuses the previous connection pool.
func revisionOf(entity clientcert.ClientCertificate) string {
	return entity.ID + "@" + strconv.FormatInt(entity.UpdatedAt.UnixNano(), 10)
}

// ConfigFor is httpconnector.ClientTLS: what Mill presents to host.
//
//wails:ignore
func (c *ConfigureService) ConfigFor(_ context.Context, host string) (*tls.Config, string, bool, error) {
	entity, ok := clientcert.MostSpecific(c.ClientCertificates(), host)
	if !ok || entity.CertRef == "" {
		return nil, "", false, nil
	}
	cfg, err := c.buildClientTLSConfig(entity)
	if err != nil {
		return nil, "", false, err
	}
	return cfg, revisionOf(entity), true, nil
}

// buildClientTLSConfig resolves one entity's references and decodes
// them. Every returned error already carries the sentence its surface
// shows.
func (c *ConfigureService) buildClientTLSConfig(entity clientcert.ClientCertificate) (*tls.Config, error) {
	cert, err := c.loadClientCertificate(entity)
	if err != nil {
		return nil, err
	}
	if cert.Leaf != nil {
		if state, _ := clientcert.StateFor(cert.Leaf.NotBefore, cert.Leaf.NotAfter, time.Now()); state == clientcert.StateExpired {
			return nil, clientcert.ExpiredError(entity.Host, cert.Leaf.NotAfter)
		}
	}
	cfg := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	if entity.CARef != "" {
		caPEM, err := c.resolveSecretRef(entity.Label, "CA certificate", entity.CARef, c.clientCertAudit())
		if err != nil {
			return nil, err
		}
		pool, err := certmaterial.CertPool([]byte(caPEM))
		if err != nil {
			return nil, clientcert.DescribeMaterialFailure(err)
		}
		cfg.RootCAs = pool
	}
	return cfg, nil
}

// loadClientCertificate reads the material one entity names.
func (c *ConfigureService) loadClientCertificate(entity clientcert.ClientCertificate) (tls.Certificate, error) {
	actx := c.clientCertAudit()
	certValue, err := c.resolveSecretRef(entity.Label, "certificate", entity.CertRef, actx)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyValue, err := c.resolveOptionalSecretRef(entity.Label, "private key", entity.KeyRef, actx)
	if err != nil {
		return tls.Certificate{}, err
	}
	passphrase, err := c.resolveOptionalSecretRef(entity.Label, "passphrase", entity.PassphraseRef, actx)
	if err != nil {
		return tls.Certificate{}, err
	}
	certBytes := decodeCertificateEntry(certValue)
	if !certmaterial.IsPKCS12(certBytes) && strings.TrimSpace(keyValue) == "" {
		return tls.Certificate{}, clientcert.ErrNoKeyChosen
	}
	cert, err := certmaterial.Load(certBytes, []byte(keyValue), passphrase)
	if err != nil {
		return tls.Certificate{}, clientcert.DescribeMaterialFailure(err)
	}
	return cert, nil
}

func (c *ConfigureService) clientCertAudit() secretaudit.AccessContext {
	return secretaudit.AccessContext{Context: secretaudit.ContextClientCertificate}
}

// handshakeTimeout bounds the Test action, the same fail-safe bound
// every other outbound call here carries.
const handshakeTimeout = 15 * time.Second

// authorityOfURL is the host[:port] a certificate is matched against.
func authorityOfURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Host)
}

// isNoKeyChosen separates "nothing picked yet" from "picked, but it
// does not work" -- the first is an incomplete row, the second an
// unreadable one.
func isNoKeyChosen(err error) bool {
	return errors.Is(err, clientcert.ErrNoKeyChosen)
}

// decodeCertificateEntry turns a stored entry into the bytes a decoder
// reads. A PEM entry is its own text; a PKCS#12 bundle is binary and
// is stored base64-encoded, since a vault entry holds text.
func decodeCertificateEntry(value string) []byte {
	trimmed := strings.TrimSpace(value)
	if strings.Contains(trimmed, "-----BEGIN") {
		return []byte(value)
	}
	if decoded, err := base64.StdEncoding.DecodeString(stripWhitespace(trimmed)); err == nil && len(decoded) > 0 {
		return decoded
	}
	return []byte(value)
}

// stripWhitespace lets a base64 bundle pasted with line breaks decode
// the same as one pasted on a single line.
func stripWhitespace(value string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' || r == ' ' {
			return -1
		}
		return r
	}, value)
}

// clientCertStatusCache holds one status per entity revision, so a
// list of certificates costs one decode each, not one per render.
type clientCertStatusCache struct {
	mu      sync.Mutex
	entries map[string]clientcert.Status
}

func (s *clientCertStatusCache) get(key string) (clientcert.Status, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	status, ok := s.entries[key]
	return status, ok
}

func (s *clientCertStatusCache) put(key string, status clientcert.Status) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entries == nil {
		s.entries = map[string]clientcert.Status{}
	}
	s.entries[key] = status
}

// Clear drops every cached status -- called on any write, and on a
// vault unlock, so a certificate that could not be read a moment ago
// is re-read rather than reported stale.
func (s *clientCertStatusCache) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = nil
}

// ClientCertificateStatuses answers one status per configured
// certificate. It returns the certificate's identity and validity
// window only, never the material.
func (c *ConfigureService) ClientCertificateStatuses() []clientcert.Status {
	entities := c.ClientCertificates()
	out := make([]clientcert.Status, 0, len(entities))
	for _, entity := range entities {
		out = append(out, c.clientCertificateStatus(entity))
	}
	return out
}

func (c *ConfigureService) clientCertificateStatus(entity clientcert.ClientCertificate) clientcert.Status {
	key := revisionOf(entity)
	if cached, ok := c.clientCertStatuses.get(key); ok {
		return cached
	}
	status := clientcert.Status{ID: entity.ID, State: clientcert.StateIncomplete}
	if entity.CertRef != "" {
		cert, err := c.loadClientCertificate(entity)
		switch {
		case err != nil && isNoKeyChosen(err):
			status.State = clientcert.StateIncomplete
		case err != nil:
			status.State = clientcert.StateUnreadable
		case cert.Leaf != nil:
			state, days := clientcert.StateFor(cert.Leaf.NotBefore, cert.Leaf.NotAfter, time.Now())
			status = clientcert.Status{
				ID: entity.ID, State: state, DaysLeft: days,
				Subject:   cert.Leaf.Subject.String(),
				Issuer:    cert.Leaf.Issuer.String(),
				NotBefore: cert.Leaf.NotBefore, NotAfter: cert.Leaf.NotAfter,
			}
		}
	}
	// An unreadable status is never cached: the usual cause is a locked
	// vault, and unlocking has to show the real state on the next read
	// rather than after a write.
	if status.State != clientcert.StateUnreadable {
		c.clientCertStatuses.put(key, status)
	}
	return status
}

// ClientCertificateMatch is what the request form shows: the entity
// that would present a certificate to a URL's host, if any.
type ClientCertificateMatch struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Host  string `json:"host"`
}

// MatchClientCertificate answers which certificate a URL's host would
// use. An unparseable or host-less URL matches nothing.
func (c *ConfigureService) MatchClientCertificate(rawURL string) (ClientCertificateMatch, bool) {
	authority := authorityOfURL(rawURL)
	if authority == "" {
		return ClientCertificateMatch{}, false
	}
	entity, ok := clientcert.MostSpecific(c.ClientCertificates(), authority)
	if !ok {
		return ClientCertificateMatch{}, false
	}
	return ClientCertificateMatch{ID: entity.ID, Label: entity.Label, Host: entity.Host}, true
}

// TestClientCertificate opens a TLS connection to the entity's host
// and closes it, sending nothing. User-initiated, so it is the person
// asking Mill to reach that host, never Mill reaching out on its own.
// A nil error is a completed handshake; the sentence reporting it is
// the caller's, so this returns no copy of its own.
func (c *ConfigureService) TestClientCertificate(id string) error {
	var entity clientcert.ClientCertificate
	found := false
	for _, candidate := range c.ClientCertificates() {
		if candidate.ID == id {
			entity, found = candidate, true
			break
		}
	}
	if !found {
		return clientCertNotFound(id)
	}
	if strings.HasPrefix(entity.Host, "*.") {
		return ErrTestNeedsExactHost
	}
	cfg, err := c.buildClientTLSConfig(entity)
	if err != nil {
		return err
	}
	address := entity.Host
	if !strings.Contains(address, ":") {
		address += ":443"
	}
	dialer := &tls.Dialer{Config: cfg}
	ctx, cancel := context.WithTimeout(context.Background(), handshakeTimeout)
	defer cancel()
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return clientcert.DescribeHandshakeFailure(err, entity.Host)
	}
	return conn.Close()
}
