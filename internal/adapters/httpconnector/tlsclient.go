package httpconnector

import (
	"context"
	"crypto/tls"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/hashicorp/go-retryablehttp"
)

// Client certificates at the transport: a request to a host Mill holds
// a client certificate for goes out on a transport carrying that
// certificate, and every other request keeps using the shared default
// client. The certificate itself is never this package's concern -- it
// asks the injected port for a ready tls.Config and knows only how to
// hang one on a transport.
//
// The port is consulted PER REQUEST rather than once per host: the
// material lives behind the same vault gate every other secret does,
// so the read has to happen at the moment of use, with its own audit
// line, never off a decrypted cache this package holds.

// ClientTLS resolves the TLS configuration Mill presents to one host.
// key identifies the configuration's source and revision, so a
// transport (and the connection pool inside it) can be reused across
// requests while the configuration is unchanged, and dropped the
// moment it is not. ok is false when no client certificate is
// configured for the host, which is the ordinary case.
type ClientTLS interface {
	ConfigFor(ctx context.Context, host string) (cfg *tls.Config, key string, ok bool, err error)
}

// ErrClientCertificateRequired is a handshake the server refused for
// want of a client certificate. Callers turn it into the sentence
// their surface shows; this package states only what happened.
var ErrClientCertificateRequired = errors.New("httpconnector: the server requires a client certificate")

var (
	clientTLSMu sync.RWMutex
	clientTLS   ClientTLS
	tlsClients  = map[string]*retryablehttp.Client{}
)

// SetClientTLS wires the resolver. Called once during composition-root
// wiring; a nil port (the default) means every request uses the shared
// client, which is exactly how this package behaved before client
// certificates existed.
func SetClientTLS(port ClientTLS) {
	clientTLSMu.Lock()
	defer clientTLSMu.Unlock()
	clientTLS = port
	tlsClients = map[string]*retryablehttp.Client{}
}

// authorityOf is the host[:port] a certificate is matched against --
// the same authority a browser would match a server certificate on.
func authorityOf(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return strings.ToLower(parsed.Host)
}

// clientForRequest picks the client one call goes out on: the shared
// default, or a per-configuration one carrying a client certificate.
func clientForRequest(ctx context.Context, rawURL string) (*retryablehttp.Client, error) {
	clientTLSMu.RLock()
	port := clientTLS
	clientTLSMu.RUnlock()
	if port == nil {
		return client, nil
	}
	authority := authorityOf(rawURL)
	if authority == "" {
		return client, nil
	}
	cfg, key, ok, err := port.ConfigFor(ctx, authority)
	if err != nil {
		return nil, err
	}
	if !ok {
		return client, nil
	}
	return tlsClientFor(key, cfg), nil
}

// tlsClientFor reuses one client per configuration key so a workflow
// making many calls to the same host keeps one connection pool, and
// so an edited certificate (a new key) is picked up on the next call
// rather than living on inside a pooled connection.
func tlsClientFor(key string, cfg *tls.Config) *retryablehttp.Client {
	clientTLSMu.Lock()
	defer clientTLSMu.Unlock()
	if existing, ok := tlsClients[key]; ok {
		return existing
	}
	c := newClient()
	transport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		// http.DefaultTransport is *http.Transport in every stdlib
		// build; a replacement installed by something else is not a
		// reason to send the request without its certificate.
		transport = &http.Transport{}
	}
	cloned := transport.Clone()
	cloned.TLSClientConfig = cfg
	c.HTTPClient.Transport = cloned
	tlsClients[key] = c
	return c
}

// InvalidateClientTLS drops every cached transport, so the next call
// to a host builds a fresh one. Called when a client certificate is
// created, edited or deleted.
func InvalidateClientTLS() {
	clientTLSMu.Lock()
	defer clientTLSMu.Unlock()
	tlsClients = map[string]*retryablehttp.Client{}
}

// IsClientCertificateRequired reports whether err is the server
// refusing the handshake for want of a client certificate. Go surfaces
// the server's alert as text on the transport error, so the alert
// names are what this reads; a direct tls.Dial from another package
// gets the same answer as a call made here.
func IsClientCertificateRequired(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrClientCertificateRequired) {
		return true
	}
	text := err.Error()
	for _, alert := range []string{"certificate required", "bad certificate", "certificate is required"} {
		if strings.Contains(text, alert) {
			return true
		}
	}
	return false
}

// classifyTLSError attaches the sentinel so a caller downstream of a
// wrapped chain still recognises the refusal.
func classifyTLSError(err error) error {
	if IsClientCertificateRequired(err) {
		return errors.Join(ErrClientCertificateRequired, err)
	}
	return err
}
