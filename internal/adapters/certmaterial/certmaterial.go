// Package certmaterial decodes client-certificate material into the
// crypto/tls values a handshake needs. It is a commodity adapter: it
// knows the file formats a certificate is exported in and nothing
// about where the bytes came from or which host they are for.
//
// Three formats are accepted, which is what the tools people export
// from produce: a PEM certificate chain beside a PEM key (PKCS#1,
// SEC 1 or PKCS#8, encrypted or not), and a PKCS#12/PFX bundle
// carrying both. The one shape deliberately refused is a PEM key
// encrypted the pre-PKCS#8 way ("Proc-Type: 4,ENCRYPTED"): its
// key derivation is unsound, crypto/x509 has removed support for it,
// and re-exporting is a one-command fix.
package certmaterial

import (
	"crypto"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"

	"github.com/youmark/pkcs8"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// Errors a caller maps onto its own user-facing sentences. Every one
// of them is a condition the person configuring the certificate can
// act on.
var (
	// ErrLegacyEncryptedPEM is a key encrypted by the pre-PKCS#8 PEM
	// scheme.
	ErrLegacyEncryptedPEM = errors.New("certmaterial: legacy encrypted PEM key")
	// ErrPassphrase is a wrong or missing passphrase.
	ErrPassphrase = errors.New("certmaterial: passphrase does not open this key")
	// ErrMismatch is a certificate and key that are not a pair.
	ErrMismatch = errors.New("certmaterial: certificate and key do not match")
	// ErrNoCertificate is material carrying no certificate at all.
	ErrNoCertificate = errors.New("certmaterial: no certificate found")
	// ErrNoKey is a PEM certificate with no key beside it.
	ErrNoKey = errors.New("certmaterial: no private key found")
)

// legacyPEMHeader marks the pre-PKCS#8 encrypted-PEM scheme.
const legacyPEMHeader = "Proc-Type"

// IsPKCS12 reports whether data is a PKCS#12/PFX bundle rather than
// PEM text. PEM is detected by its own armour, so anything that is not
// PEM is tried as DER -- which is what a bundle exported from a
// browser, Windows, or Keychain always is.
func IsPKCS12(data []byte) bool {
	block, _ := pem.Decode(data)
	return block == nil
}

// Load builds the certificate a TLS handshake presents. certData is
// either PEM (chain) or a PKCS#12 bundle; keyData is the PEM key
// beside a PEM chain and is ignored for a bundle; passphrase opens an
// encrypted key or bundle.
//
// The returned tls.Certificate carries the whole chain the material
// held, leaf first, so a server that needs the intermediates gets
// them.
func Load(certData, keyData []byte, passphrase string) (tls.Certificate, error) {
	if IsPKCS12(certData) {
		return loadPKCS12(certData, passphrase)
	}
	return loadPEM(certData, keyData, passphrase)
}

func loadPKCS12(data []byte, passphrase string) (tls.Certificate, error) {
	key, leaf, chain, err := pkcs12.DecodeChain(data, passphrase)
	if err != nil {
		if errors.Is(err, pkcs12.ErrIncorrectPassword) {
			return tls.Certificate{}, ErrPassphrase
		}
		return tls.Certificate{}, fmt.Errorf("certmaterial: decode bundle: %w", err)
	}
	if leaf == nil {
		return tls.Certificate{}, ErrNoCertificate
	}
	out := tls.Certificate{PrivateKey: key, Leaf: leaf, Certificate: [][]byte{leaf.Raw}}
	for _, ca := range chain {
		out.Certificate = append(out.Certificate, ca.Raw)
	}
	return out, nil
}

func loadPEM(certData, keyData []byte, passphrase string) (tls.Certificate, error) {
	chain, err := decodeCertChain(certData)
	if err != nil {
		return tls.Certificate{}, err
	}
	key, err := decodeKey(keyData, passphrase)
	if err != nil {
		return tls.Certificate{}, err
	}
	out := tls.Certificate{PrivateKey: key, Leaf: chain[0]}
	for _, c := range chain {
		out.Certificate = append(out.Certificate, c.Raw)
	}
	// X509KeyPair is the stdlib's own pairing check; running it on the
	// already-decoded values is what turns a mismatched pair into one
	// named error instead of a handshake failure minutes later.
	if _, err := x509.ParseCertificate(out.Certificate[0]); err != nil {
		return tls.Certificate{}, ErrNoCertificate
	}
	if !keyMatchesCertificate(key, chain[0]) {
		return tls.Certificate{}, ErrMismatch
	}
	return out, nil
}

func decodeCertChain(data []byte) ([]*x509.Certificate, error) {
	var chain []*x509.Certificate
	rest := data
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("certmaterial: parse certificate: %w", err)
		}
		chain = append(chain, cert)
	}
	if len(chain) == 0 {
		return nil, ErrNoCertificate
	}
	return chain, nil
}

// decodeKey reads the first PEM key block. PKCS#8 (encrypted or not),
// PKCS#1 and SEC 1 are all accepted, so a key exported by any common
// tool works without the person knowing which one they have.
func decodeKey(data []byte, passphrase string) (any, error) {
	rest := data
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			return nil, ErrNoKey
		}
		if !isKeyBlock(block.Type) {
			continue
		}
		if _, legacy := block.Headers[legacyPEMHeader]; legacy {
			return nil, ErrLegacyEncryptedPEM
		}
		return parseKeyBlock(block, passphrase)
	}
}

func isKeyBlock(blockType string) bool {
	switch blockType {
	case "PRIVATE KEY", "ENCRYPTED PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY":
		return true
	}
	return false
}

func parseKeyBlock(block *pem.Block, passphrase string) (any, error) {
	if block.Type == "ENCRYPTED PRIVATE KEY" || passphrase != "" {
		// pkcs8.ParsePKCS8PrivateKey reads BOTH the encrypted and the
		// plain form, so a passphrase supplied for a key that turns out
		// not to need one still parses.
		key, err := pkcs8.ParsePKCS8PrivateKey(block.Bytes, []byte(passphrase))
		if err == nil {
			return key, nil
		}
		if block.Type == "ENCRYPTED PRIVATE KEY" {
			return nil, ErrPassphrase
		}
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	return nil, ErrNoKey
}

// keyMatchesCertificate compares the key's own public half against the
// certificate's, the same check tls.X509KeyPair performs.
func keyMatchesCertificate(key any, cert *x509.Certificate) bool {
	type publicKeyHolder interface{ Public() crypto.PublicKey }
	holder, ok := key.(publicKeyHolder)
	if !ok {
		return false
	}
	type equaler interface{ Equal(crypto.PublicKey) bool }
	pub, ok := cert.PublicKey.(equaler)
	if !ok {
		return false
	}
	return pub.Equal(holder.Public())
}

// CertPool returns the system pool with pem's roots ADDED. A private
// root a server presents is an addition to what the machine already
// trusts, never a replacement -- replacing it would silently narrow
// every other connection this transport makes.
func CertPool(pemData []byte) (*x509.CertPool, error) {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if len(pemData) == 0 {
		return pool, nil
	}
	if !pool.AppendCertsFromPEM(pemData) {
		return nil, ErrNoCertificate
	}
	return pool, nil
}
