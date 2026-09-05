package configuresvc

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretauditstore"
	"github.com/alicoding/mill/internal/domain/clientcert"
	"github.com/alicoding/mill/internal/domain/usererror"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// Client certificates end to end (goal 0306 S1): a real mutual-TLS
// server that refuses anyone without a certificate, real vault entries
// behind the same unlock gate every other secret has, and the real
// transport path an integration-http step takes.

type testCA struct {
	cert *x509.Certificate
	key  *rsa.PrivateKey
	pem  []byte
}

func newTestCA(t *testing.T) testCA {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Mill test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create CA: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse CA: %v", err)
	}
	return testCA{cert: cert, key: key, pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
}

// issueLeaf signs one leaf with the CA. notAfter lets a test mint an
// already-expired certificate without waiting for one to expire.
func (ca testCA) issueLeaf(t *testing.T, cn string, client bool, notAfter time.Time) (tls.Certificate, []byte, []byte) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
	}
	if client {
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
	} else {
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
		template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
		template.DNSNames = []string{"localhost"}
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatalf("sign leaf: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal leaf key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatalf("pair leaf: %v", err)
	}
	pair.Leaf, _ = x509.ParseCertificate(der)
	return pair, certPEM, keyPEM
}

// startMutualTLSServer refuses every caller that presents no
// certificate signed by ca.
func startMutualTLSServer(t *testing.T, ca testCA) *httptest.Server {
	t.Helper()
	serverPair, _, _ := ca.issueLeaf(t, "localhost", false, time.Now().Add(24*time.Hour))
	pool := x509.NewCertPool()
	pool.AddCert(ca.cert)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("mutual"))
	}))
	srv.TLS = &tls.Config{
		Certificates: []tls.Certificate{serverPair},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
		MinVersion:   tls.VersionTLS12,
	}
	srv.StartTLS()
	t.Cleanup(srv.Close)
	return srv
}

// newClientCertService builds a service with a real vault behind it and
// resets the process-wide transport wiring afterwards, so one test's
// port never answers another's request.
func newClientCertService(t *testing.T) (*ConfigureService, func(title, value, kind string) string) {
	t.Helper()
	cfg, _ := newTestConfigureService(t)
	// The seeded example covers api.example.com; a test asserting on
	// matching starts from an empty list so the seed can never be the
	// entity a case accidentally resolves.
	cfg.clientCerts = nil
	secrets, _ := newAuditedSecretService(t, cfg)
	httpconnector.SetClientTLS(cfg)
	t.Cleanup(func() { httpconnector.SetClientTLS(nil) })
	return cfg, func(title, value, kind string) string {
		t.Helper()
		entry, err := secrets.CreateSecret(title, "", value, "", "", nil, kind, "", nil)
		if err != nil {
			t.Fatalf("CreateSecret(%q): %v", title, err)
		}
		return "vault:" + entry.ID
	}
}

func TestClientCertificate_IntegrationHTTPSucceedsWithAMatchingEntity(t *testing.T) {
	ca := newTestCA(t)
	srv := startMutualTLSServer(t, ca)
	cfg, store := newClientCertService(t)
	_, certPEM, keyPEM := ca.issueLeaf(t, "mill-client", true, time.Now().Add(24*time.Hour))

	host := strings.TrimPrefix(srv.URL, "https://")
	if _, err := cfg.CreateClientCertificate("Test host", host,
		store("cert", string(certPEM), "certificate"),
		store("key", string(keyPEM), "key"),
		"", store("ca", string(ca.pem), "certificate"), ""); err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}

	resp, err := httpconnector.Execute(httpconnector.Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("Execute through the mutual-TLS server: %v", err)
	}
	if resp.StatusCode != http.StatusOK || resp.Body != "mutual" {
		t.Fatalf("Execute = %d %q, want 200 mutual", resp.StatusCode, resp.Body)
	}
}

// The refusal a reader can act on: the server asked for a certificate
// and nothing configured matches its host.
func TestClientCertificate_UnmatchedHostReportsTheServersRefusal(t *testing.T) {
	ca := newTestCA(t)
	srv := startMutualTLSServer(t, ca)
	cfg, store := newClientCertService(t)
	_, certPEM, keyPEM := ca.issueLeaf(t, "mill-client", true, time.Now().Add(24*time.Hour))
	// Configured for a DIFFERENT host, so the match must fail.
	if _, err := cfg.CreateClientCertificate("Elsewhere", "api.elsewhere.invalid",
		store("cert", string(certPEM), "certificate"),
		store("key", string(keyPEM), "key"), "", "", ""); err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}

	host := strings.TrimPrefix(srv.URL, "https://")
	pool := x509.NewCertPool()
	pool.AddCert(ca.cert)
	dialer := &tls.Dialer{Config: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}
	conn, err := dialer.DialContext(t.Context(), "tcp", host)
	if err == nil {
		// TLS 1.3 defers the server's complaint to the first read.
		_, err = conn.Write([]byte("GET / HTTP/1.0\r\n\r\n"))
		if err == nil {
			buf := make([]byte, 1)
			_, err = conn.Read(buf)
		}
		_ = conn.Close()
	}
	described := clientcert.DescribeTransportFailure(err, host)
	want := "The server asked for a client certificate and none matches " + host + "."
	if described == nil || described.Error() != want {
		t.Fatalf("DescribeTransportFailure = %v, want %q", described, want)
	}
}

func TestClientCertificate_ResolutionRecordsOneAuditLinePerRead(t *testing.T) {
	ca := newTestCA(t)
	cfg, _ := newTestConfigureService(t)
	cfg.clientCerts = nil
	secrets, auditStore := newAuditedSecretService(t, cfg)
	httpconnector.SetClientTLS(cfg)
	t.Cleanup(func() { httpconnector.SetClientTLS(nil) })
	_, certPEM, keyPEM := ca.issueLeaf(t, "mill-client", true, time.Now().Add(24*time.Hour))
	certEntry, err := secrets.CreateSecret("cert", "", string(certPEM), "", "", nil, "certificate", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	keyEntry, err := secrets.CreateSecret("key", "", string(keyPEM), "", "", nil, "key", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if _, err := cfg.CreateClientCertificate("Audited", "api.example.com", "vault:"+certEntry.ID, "vault:"+keyEntry.ID, "", "", ""); err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}

	if _, _, ok, err := cfg.ConfigFor(t.Context(), "api.example.com"); err != nil || !ok {
		t.Fatalf("ConfigFor = ok %v, err %v, want a resolved config", ok, err)
	}
	records, total, err := auditStore.List(secretauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 2 {
		t.Fatalf("audit rows = %d, want one per reference read (certificate and key): %+v", total, records)
	}
	for _, r := range records {
		if r.Context != secretaudit.ContextClientCertificate {
			t.Fatalf("audit context = %q, want %q", r.Context, secretaudit.ContextClientCertificate)
		}
	}
}

// A locked vault is the same gate every other secret sits behind: the
// resolution fails loudly rather than sending the request bare.
func TestClientCertificate_LockedVaultRefusesToResolve(t *testing.T) {
	ca := newTestCA(t)
	cfg, store := newClientCertService(t)
	_, certPEM, keyPEM := ca.issueLeaf(t, "mill-client", true, time.Now().Add(24*time.Hour))
	certRef := store("cert", string(certPEM), "certificate")
	keyRef := store("key", string(keyPEM), "key")
	if _, err := cfg.CreateClientCertificate("Locked", "api.example.com", certRef, keyRef, "", "", ""); err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		return "", errors.New("vault is locked")
	})
	if _, _, ok, err := cfg.ConfigFor(t.Context(), "api.example.com"); err == nil || ok {
		t.Fatalf("ConfigFor with a locked vault = ok %v, err %v, want a refusal", ok, err)
	}
	for _, status := range cfg.ClientCertificateStatuses() {
		if status.State != clientcert.StateUnreadable {
			t.Fatalf("status with a locked vault = %q, want %q", status.State, clientcert.StateUnreadable)
		}
	}
}

func TestClientCertificate_PKCS12BundleNeedsNoSeparateKey(t *testing.T) {
	ca := newTestCA(t)
	srv := startMutualTLSServer(t, ca)
	cfg, store := newClientCertService(t)
	pair, _, _ := ca.issueLeaf(t, "mill-bundle", true, time.Now().Add(24*time.Hour))
	bundle, err := pkcs12.Modern.Encode(pair.PrivateKey, pair.Leaf, nil, "bundle-pw")
	if err != nil {
		t.Fatalf("encode bundle: %v", err)
	}
	host := strings.TrimPrefix(srv.URL, "https://")
	if _, err := cfg.CreateClientCertificate("Bundle", host,
		store("bundle", base64.StdEncoding.EncodeToString(bundle), "file"),
		"", store("bundle passphrase", "bundle-pw", "text"),
		store("ca", string(ca.pem), "certificate"), ""); err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}
	resp, err := httpconnector.Execute(httpconnector.Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("Execute with a PKCS#12 bundle: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Execute = %d, want 200", resp.StatusCode)
	}
}

func TestClientCertificate_ExpiredCertificateNamesTheDay(t *testing.T) {
	ca := newTestCA(t)
	cfg, store := newClientCertService(t)
	_, certPEM, keyPEM := ca.issueLeaf(t, "mill-expired", true, time.Now().Add(-time.Minute))
	if _, err := cfg.CreateClientCertificate("Expired", "api.example.com",
		store("cert", string(certPEM), "certificate"), store("key", string(keyPEM), "key"), "", "", ""); err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}
	_, _, _, err := cfg.ConfigFor(t.Context(), "api.example.com")
	userErr, ok := usererror.Of(err)
	if !ok || userErr.Code != clientcert.CodeExpired {
		t.Fatalf("ConfigFor with an expired certificate = %v, want the %q sentence", err, clientcert.CodeExpired)
	}
	if !strings.HasPrefix(userErr.Message, "The certificate for api.example.com expired on ") {
		t.Fatalf("sentence = %q, want it to name the host and the day", userErr.Message)
	}
	for _, status := range cfg.ClientCertificateStatuses() {
		if status.State != clientcert.StateExpired {
			t.Fatalf("status = %q, want %q", status.State, clientcert.StateExpired)
		}
	}
}

func TestClientCertificate_StatusReportsIncompleteAndReady(t *testing.T) {
	ca := newTestCA(t)
	cfg, store := newClientCertService(t)
	_, certPEM, keyPEM := ca.issueLeaf(t, "mill-status", true, time.Now().Add(365*24*time.Hour))
	created, err := cfg.CreateClientCertificate("Status", "api.example.com", "", "", "", "", "")
	if err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}
	if got := statusOf(t, cfg, created.ID); got.State != clientcert.StateIncomplete {
		t.Fatalf("status with no references = %q, want %q", got.State, clientcert.StateIncomplete)
	}
	// A certificate with no key beside it is still incomplete, not broken.
	if _, err := cfg.UpdateClientCertificate(created.ID, "Status", "api.example.com", store("cert", string(certPEM), "certificate"), "", "", "", ""); err != nil {
		t.Fatalf("UpdateClientCertificate: %v", err)
	}
	if got := statusOf(t, cfg, created.ID); got.State != clientcert.StateIncomplete {
		t.Fatalf("status with no key = %q, want %q", got.State, clientcert.StateIncomplete)
	}
	if _, err := cfg.UpdateClientCertificate(created.ID, "Status", "api.example.com",
		store("cert2", string(certPEM), "certificate"), store("key2", string(keyPEM), "key"), "", "", ""); err != nil {
		t.Fatalf("UpdateClientCertificate: %v", err)
	}
	got := statusOf(t, cfg, created.ID)
	if got.State != clientcert.StateReady {
		t.Fatalf("status with both = %q, want %q", got.State, clientcert.StateReady)
	}
	if got.Subject == "" || got.Issuer == "" || got.NotAfter.IsZero() {
		t.Fatalf("status = %+v, want the certificate's identity and window", got)
	}
}

func TestMatchClientCertificate_AnswersTheRequestFormsLine(t *testing.T) {
	cfg, _ := newClientCertService(t)
	if _, err := cfg.CreateClientCertificate("Estate", "*.example.com", "", "", "", "", ""); err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}
	match, ok := cfg.MatchClientCertificate("https://api.example.com/v1/things")
	if !ok || match.Label != "Estate" {
		t.Fatalf("MatchClientCertificate = %+v (ok=%v), want the wildcard entity", match, ok)
	}
	if _, ok := cfg.MatchClientCertificate("https://api.elsewhere.com/v1"); ok {
		t.Fatal("MatchClientCertificate on an uncovered host = matched, want no match")
	}
}

func TestTestClientCertificate_RefusesAWildcardHost(t *testing.T) {
	cfg, _ := newClientCertService(t)
	created, err := cfg.CreateClientCertificate("Estate", "*.example.com", "", "", "", "", "")
	if err != nil {
		t.Fatalf("CreateClientCertificate: %v", err)
	}
	if err := cfg.TestClientCertificate(created.ID); !errors.Is(err, ErrTestNeedsExactHost) {
		t.Fatalf("TestClientCertificate on a wildcard = %v, want ErrTestNeedsExactHost", err)
	}
}

func statusOf(t *testing.T, cfg *ConfigureService, id string) clientcert.Status {
	t.Helper()
	for _, status := range cfg.ClientCertificateStatuses() {
		if status.ID == id {
			return status
		}
	}
	t.Fatalf("no status for %q", id)
	return clientcert.Status{}
}
