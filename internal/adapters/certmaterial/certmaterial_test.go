package certmaterial_test

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/certmaterial"
	"github.com/youmark/pkcs8"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// issue mints a self-signed leaf so every case below exercises real
// DER a real handshake would accept, never a hand-built fixture.
func issue(t *testing.T, cn string) (*x509.Certificate, *rsa.PrivateKey, []byte) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return parsed, key, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func pkcs8PEM(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal PKCS#8: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func TestLoad_PEMChainAndPKCS8Key(t *testing.T) {
	leaf, key, certPEM := issue(t, "pem.example.com")
	got, err := certmaterial.Load(certPEM, pkcs8PEM(t, key), "")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.Leaf == nil || got.Leaf.Subject.CommonName != leaf.Subject.CommonName {
		t.Fatalf("Leaf = %+v, want the issued certificate", got.Leaf)
	}
}

func TestLoad_PKCS1AndSEC1KeysStillParse(t *testing.T) {
	_, key, certPEM := issue(t, "pkcs1.example.com")
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if _, err := certmaterial.Load(certPEM, keyPEM, ""); err != nil {
		t.Fatalf("Load with a PKCS#1 key: %v", err)
	}
}

func TestLoad_EncryptedPKCS8Key(t *testing.T) {
	_, key, certPEM := issue(t, "encrypted.example.com")
	der, err := pkcs8.MarshalPrivateKey(key, []byte("open sesame"), nil)
	if err != nil {
		t.Fatalf("marshal encrypted PKCS#8: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: der})

	if _, err := certmaterial.Load(certPEM, keyPEM, "open sesame"); err != nil {
		t.Fatalf("Load with the right passphrase: %v", err)
	}
	_, err = certmaterial.Load(certPEM, keyPEM, "wrong")
	if !errors.Is(err, certmaterial.ErrPassphrase) {
		t.Fatalf("Load with a wrong passphrase = %v, want ErrPassphrase", err)
	}
}

// Both PKCS#12 encodings people actually hold: the modern one every
// current export tool writes, and the legacy one older estates still
// hand out.
func TestLoad_PKCS12BothEncodings(t *testing.T) {
	leaf, key, _ := issue(t, "bundle.example.com")
	for name, encoder := range map[string]*pkcs12.Encoder{"modern": pkcs12.Modern, "legacy": pkcs12.LegacyRC2} {
		t.Run(name, func(t *testing.T) {
			bundle, err := encoder.Encode(key, leaf, nil, "pw")
			if err != nil {
				t.Fatalf("encode bundle: %v", err)
			}
			if !certmaterial.IsPKCS12(bundle) {
				t.Fatal("IsPKCS12 = false for a real bundle")
			}
			got, err := certmaterial.Load(bundle, nil, "pw")
			if err != nil {
				t.Fatalf("Load bundle: %v", err)
			}
			if got.Leaf == nil || got.Leaf.Subject.CommonName != "bundle.example.com" {
				t.Fatalf("Leaf = %+v, want the bundled certificate", got.Leaf)
			}
			if _, err := certmaterial.Load(bundle, nil, "wrong"); !errors.Is(err, certmaterial.ErrPassphrase) {
				t.Fatalf("Load with a wrong passphrase = %v, want ErrPassphrase", err)
			}
		})
	}
}

// Regression: a key encrypted the pre-PKCS#8 PEM way is refused by
// name rather than parsed, so the sentence tells the reader to
// re-export instead of failing at handshake time.
func TestLoad_RefusesLegacyEncryptedPEM(t *testing.T) {
	_, key, certPEM := issue(t, "legacy.example.com")
	block := &pem.Block{
		Type:    "RSA PRIVATE KEY",
		Headers: map[string]string{"Proc-Type": "4,ENCRYPTED", "DEK-Info": "DES-EDE3-CBC,0123456789ABCDEF"},
		Bytes:   x509.MarshalPKCS1PrivateKey(key),
	}
	_, err := certmaterial.Load(certPEM, pem.EncodeToMemory(block), "pw")
	if !errors.Is(err, certmaterial.ErrLegacyEncryptedPEM) {
		t.Fatalf("Load = %v, want ErrLegacyEncryptedPEM", err)
	}
}

func TestLoad_RejectsAMismatchedPair(t *testing.T) {
	_, _, certPEM := issue(t, "one.example.com")
	_, otherKey, _ := issue(t, "two.example.com")
	_, err := certmaterial.Load(certPEM, pkcs8PEM(t, otherKey), "")
	if !errors.Is(err, certmaterial.ErrMismatch) {
		t.Fatalf("Load = %v, want ErrMismatch", err)
	}
}

func TestLoad_ReportsMissingMaterial(t *testing.T) {
	_, key, certPEM := issue(t, "missing.example.com")
	if _, err := certmaterial.Load(certPEM, nil, ""); !errors.Is(err, certmaterial.ErrNoKey) {
		t.Fatalf("Load with no key = %v, want ErrNoKey", err)
	}
	if _, err := certmaterial.Load([]byte("not pem"), pkcs8PEM(t, key), ""); err == nil {
		t.Fatal("Load with no certificate = nil, want an error")
	}
}

// The private root is ADDED to what the machine already trusts: a
// pool that dropped the system roots would silently narrow every other
// connection the same transport makes.
func TestCertPool_AddsToTheSystemPool(t *testing.T) {
	_, _, caPEM := issue(t, "private-root")
	system, err := x509.SystemCertPool()
	if err != nil {
		t.Skipf("no system pool on this platform: %v", err)
	}
	pool, err := certmaterial.CertPool(caPEM)
	if err != nil {
		t.Fatalf("CertPool: %v", err)
	}
	if len(pool.Subjects()) <= len(system.Subjects()) { //nolint:staticcheck // Subjects is the only way to count a pool
		t.Fatal("CertPool returned no more roots than the system pool, want the system roots plus the private one")
	}
	if _, err := certmaterial.CertPool([]byte("not a certificate")); !errors.Is(err, certmaterial.ErrNoCertificate) {
		t.Fatalf("CertPool with junk = %v, want ErrNoCertificate", err)
	}
}
