// Package clientcert is the Configure entity naming which client
// certificate Mill presents to which host. A certificate is configured
// per host, once, and applies to every request Mill makes to that host
// -- never per request, which is the shape every HTTP client that has
// solved this converged on.
//
// Every credential field here holds a vault REFERENCE, never the
// material: the certificate, its key, its passphrase and a private CA
// all live in the secret store, and this entity names them. Nothing in
// this package decodes or holds key material; resolution and decoding
// happen at the moment a request is made.
package clientcert

import (
	"errors"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// ClientCertificate is one host's client-certificate configuration.
type ClientCertificate struct {
	ID    string
	Label string
	// Host is an exact host ("api.example.com"), or a wildcard whose
	// only "*" is the leftmost label ("*.example.com"). A port may be
	// appended ("api.example.com:8443"); a Host with no port matches
	// every port.
	Host string
	// CertRef names the certificate: a PEM chain (kind certificate), or
	// a PKCS#12 bundle (kind file) that carries its own key.
	CertRef string
	// KeyRef names the private key (kind key). Empty when CertRef is a
	// PKCS#12 bundle.
	KeyRef string
	// PassphraseRef names the passphrase (kind text) for an encrypted
	// PKCS#8 key or a PKCS#12 bundle.
	PassphraseRef string
	// CARef names a private root the server presents (kind
	// certificate). It is ADDED to the system pool, never a
	// replacement for it.
	CARef     string
	Notes     string
	BuiltIn   bool
	Seed      seedorigin.Origin
	CreatedAt time.Time
	UpdatedAt time.Time
}

var ErrInvalid = errors.New("client certificate: invalid")

// Validate normalizes and checks the fields a save must hold: a label,
// and a host Mill can match a request URL against. Whether the named
// vault entries currently decode is a STATUS question, answered when
// the material is read, never a save refusal -- an entity authored
// before its certificate exists is a legitimate state the list reports.
func Validate(c *ClientCertificate) error {
	c.Label = strings.TrimSpace(c.Label)
	if c.Label == "" {
		return errors.Join(ErrInvalid, errors.New("a label is required"))
	}
	host, err := NormalizeHost(c.Host)
	if err != nil {
		return err
	}
	c.Host = host
	c.Notes = strings.TrimSpace(c.Notes)
	return nil
}

// NormalizeHost lowercases and checks one host pattern.
func NormalizeHost(raw string) (string, error) {
	host := strings.ToLower(strings.TrimSpace(raw))
	host = strings.TrimSuffix(host, ".")
	if host == "" {
		return "", errors.Join(ErrInvalid, errors.New("a host is required"))
	}
	name, port := splitPort(host)
	if name == "" {
		return "", errors.Join(ErrInvalid, errors.New("a host is required"))
	}
	if port != "" && strings.ContainsAny(port, "*") {
		return "", errors.Join(ErrInvalid, errors.New("a port cannot be a wildcard"))
	}
	labels := strings.Split(name, ".")
	for i, label := range labels {
		if label == "" {
			return "", errors.Join(ErrInvalid, errors.New("a host cannot have an empty label"))
		}
		if !strings.Contains(label, "*") {
			continue
		}
		if i != 0 || label != "*" || len(labels) < 2 {
			return "", errors.Join(ErrInvalid, errors.New("a wildcard is only the leftmost label, as in *.example.com"))
		}
	}
	return host, nil
}

// splitPort separates "host:port" without needing a scheme. An IPv6
// literal keeps its brackets with the name.
func splitPort(host string) (name, port string) {
	if strings.HasPrefix(host, "[") {
		if end := strings.LastIndex(host, "]"); end >= 0 {
			rest := host[end+1:]
			return host[:end+1], strings.TrimPrefix(rest, ":")
		}
		return host, ""
	}
	if i := strings.LastIndex(host, ":"); i >= 0 && !strings.Contains(host[i+1:], ":") {
		return host[:i], host[i+1:]
	}
	return host, ""
}

// Specificity scores how well pattern matches the authority of a
// request URL ("api.example.com" or "api.example.com:8443"). A higher
// score is a more specific match: an exact host always beats a
// wildcard, and among wildcards the longer suffix wins. ok is false
// when the pattern does not match at all.
//
// The scores are ordinals, not measurements: only their ORDER is
// meaningful, and only within one call site's comparison.
func Specificity(pattern, authority string) (score int, ok bool) {
	patternName, patternPort := splitPort(strings.ToLower(strings.TrimSpace(pattern)))
	hostName, hostPort := splitPort(strings.ToLower(strings.TrimSpace(authority)))
	hostName = strings.TrimSuffix(hostName, ".")
	if hostName == "" {
		return 0, false
	}
	if patternPort != "" && patternPort != hostPort {
		return 0, false
	}
	// A pattern naming a port is more specific than the same pattern
	// without one, so a host-and-port entry wins over a host-only one.
	portBonus := 0
	if patternPort != "" {
		portBonus = 1
	}
	if !strings.HasPrefix(patternName, "*.") {
		if patternName != hostName {
			return 0, false
		}
		return 1_000_000 + portBonus, true
	}
	suffix := patternName[1:] // ".example.com"
	if !strings.HasSuffix(hostName, suffix) || len(hostName) <= len(suffix) {
		return 0, false
	}
	// A wildcard covers exactly one extra label, the same rule TLS
	// name matching uses: *.example.com does not cover a.b.example.com.
	if strings.Contains(strings.TrimSuffix(hostName, suffix), ".") {
		return 0, false
	}
	return len(suffix)*2 + portBonus, true
}

// MostSpecific picks the entity that should present a certificate to
// authority, or reports that none does.
func MostSpecific(certs []ClientCertificate, authority string) (ClientCertificate, bool) {
	best := -1
	var chosen ClientCertificate
	for _, c := range certs {
		score, ok := Specificity(c.Host, authority)
		if !ok || score <= best {
			continue
		}
		best, chosen = score, c
	}
	return chosen, best >= 0
}

// ExampleID is the seeded example every instance starts with. A seed
// carries no references: a vault entry's id is per device, so the
// example shows the shape and reports honestly that it has no material
// yet.
const ExampleID = "clientcert-example"

// BuiltIn is the seeded example set.
func BuiltIn() []ClientCertificate {
	return []ClientCertificate{{
		ID:      ExampleID,
		Label:   "Example: Client certificate for api.example.com",
		Host:    "api.example.com",
		Notes:   "Pick the certificate and key this host expects, then every request Mill sends there presents them.",
		BuiltIn: true,
		Seed:    seedorigin.Stamp(1),
	}}
}
