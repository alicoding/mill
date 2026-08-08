package composition

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	josepkg "github.com/go-jose/go-jose/v4"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// ADR-0015 Phase 3: real RSA-OAEP-256 + A256GCM round trips against
// go-jose/v4's own APIs directly (not just that applyJOSEEncryption/
// decryptJOSEResponse compile), same "recompute independently, don't
// just call the code under test" discipline authstrategy_test.go
// already established for HMAC/OAuth1.

func generateRSAKeyPairPEM(t *testing.T) (privPEM, pubPEM string, priv *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey returned error: %v", err)
	}
	privBytes, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey returned error: %v", err)
	}
	privPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privBytes}))
	pubBytes, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatalf("MarshalPKIXPublicKey returned error: %v", err)
	}
	pubPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes}))
	return privPEM, pubPEM, key
}

func TestApplyJOSEEncryption_NilOrDisabled_NoOp(t *testing.T) {
	body, err := ApplyJOSEEncryption(nil, "plaintext")
	if err != nil || body != "plaintext" {
		t.Errorf("ApplyJOSEEncryption(nil, ...) = (%q, %v), want (\"plaintext\", nil)", body, err)
	}
	body, err = ApplyJOSEEncryption(&httprequest.JOSEConfig{Enabled: false}, "plaintext")
	if err != nil || body != "plaintext" {
		t.Errorf("ApplyJOSEEncryption(disabled, ...) = (%q, %v), want (\"plaintext\", nil)", body, err)
	}
}

func TestDecryptJOSEResponse_NilOrDisabled_NoOp(t *testing.T) {
	body, err := DecryptJOSEResponse(nil, "", "ciphertext")
	if err != nil || body != "ciphertext" {
		t.Errorf("DecryptJOSEResponse(nil, ...) = (%q, %v), want (\"ciphertext\", nil)", body, err)
	}
	body, err = DecryptJOSEResponse(&httprequest.JOSEConfig{DecryptResponse: false}, "", "ciphertext")
	if err != nil || body != "ciphertext" {
		t.Errorf("DecryptJOSEResponse(DecryptResponse=false, ...) = (%q, %v), want (\"ciphertext\", nil)", body, err)
	}
}

// TestApplyJOSEEncryption_ProducesRealJWE_DecryptableIndependently
// encrypts via applyJOSEEncryption, then decrypts via go-jose/v4's own
// raw API directly (not decryptJOSEResponse) -- proves the produced
// string is a genuine, standards-conformant JWE, not just "some
// string this package's own decrypt function happens to accept."
func TestApplyJOSEEncryption_ProducesRealJWE_DecryptableIndependently(t *testing.T) {
	privPEM, pubPEM, priv := generateRSAKeyPairPEM(t)
	_ = privPEM

	conf := &httprequest.JOSEConfig{Enabled: true, RecipientPublicKeyPEM: pubPEM}
	jwe, err := ApplyJOSEEncryption(conf, `{"account":"12345"}`)
	if err != nil {
		t.Fatalf("applyJOSEEncryption returned error: %v", err)
	}
	if jwe == `{"account":"12345"}` {
		t.Fatal("applyJOSEEncryption returned the plaintext unchanged, want a JWE compact string")
	}
	if strings.Count(jwe, ".") != 4 {
		t.Errorf("jwe = %q, want 5 dot-separated parts (JWE compact serialization)", jwe)
	}

	obj, err := josepkg.ParseEncrypted(jwe, []josepkg.KeyAlgorithm{josepkg.RSA_OAEP_256}, []josepkg.ContentEncryption{josepkg.A256GCM})
	if err != nil {
		t.Fatalf("go-jose ParseEncrypted returned error: %v", err)
	}
	plaintext, err := obj.Decrypt(priv)
	if err != nil {
		t.Fatalf("go-jose Decrypt returned error: %v", err)
	}
	if string(plaintext) != `{"account":"12345"}` {
		t.Errorf("decrypted plaintext = %q, want %q", plaintext, `{"account":"12345"}`)
	}
}

// TestDecryptJOSEResponse_DecryptsRealJWE_EncryptedIndependently
// encrypts via go-jose/v4's own raw API directly, then decrypts via
// decryptJOSEResponse -- the mirror of the test above.
func TestDecryptJOSEResponse_DecryptsRealJWE_EncryptedIndependently(t *testing.T) {
	privPEM, pubPEM, _ := generateRSAKeyPairPEM(t)

	block, _ := pem.Decode([]byte(pubPEM))
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		t.Fatalf("ParsePKIXPublicKey returned error: %v", err)
	}
	encrypter, err := josepkg.NewEncrypter(josepkg.A256GCM, josepkg.Recipient{Algorithm: josepkg.RSA_OAEP_256, Key: pub}, nil)
	if err != nil {
		t.Fatalf("NewEncrypter returned error: %v", err)
	}
	obj, err := encrypter.Encrypt([]byte(`{"status":"approved"}`))
	if err != nil {
		t.Fatalf("Encrypt returned error: %v", err)
	}
	jwe, err := obj.CompactSerialize()
	if err != nil {
		t.Fatalf("CompactSerialize returned error: %v", err)
	}

	conf := &httprequest.JOSEConfig{DecryptResponse: true}
	plaintext, err := DecryptJOSEResponse(conf, privPEM, jwe)
	if err != nil {
		t.Fatalf("decryptJOSEResponse returned error: %v", err)
	}
	if plaintext != `{"status":"approved"}` {
		t.Errorf("decryptJOSEResponse = %q, want %q", plaintext, `{"status":"approved"}`)
	}
}

func TestDecryptJOSEResponse_WrongPrivateKey_Rejected(t *testing.T) {
	_, pubPEM, _ := generateRSAKeyPairPEM(t)
	wrongPrivPEM, _, _ := generateRSAKeyPairPEM(t)

	block, _ := pem.Decode([]byte(pubPEM))
	pub, _ := x509.ParsePKIXPublicKey(block.Bytes)
	encrypter, _ := josepkg.NewEncrypter(josepkg.A256GCM, josepkg.Recipient{Algorithm: josepkg.RSA_OAEP_256, Key: pub}, nil)
	obj, _ := encrypter.Encrypt([]byte("secret"))
	jwe, _ := obj.CompactSerialize()

	if _, err := DecryptJOSEResponse(&httprequest.JOSEConfig{DecryptResponse: true}, wrongPrivPEM, jwe); err == nil {
		t.Fatal("decryptJOSEResponse with the wrong private key returned nil error, want an error")
	}
}

// TestExecuteWorkflow_IntegrationHTTP_JOSE_EncryptsRequestAndDecryptsResponse
// is the full, end-to-end proof: a real integration-http node run
// through ExecuteWorkflow, against a real httptest.Server that itself
// decrypts the incoming request with the "vendor's" private key and
// encrypts its response with Mill's own public key -- two independent
// RSA keypairs, matching the real bidirectional shape (docs/SPEC.md
// §3.2's Update), not a single shared key standing in for both
// directions.
func TestExecuteWorkflow_IntegrationHTTP_JOSE_EncryptsRequestAndDecryptsResponse(t *testing.T) {
	vendorPrivPEM, vendorPubPEM, vendorPriv := generateRSAKeyPairPEM(t)
	millPrivPEM, millPubPEM, _ := generateRSAKeyPairPEM(t)
	_ = vendorPrivPEM

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf, _ := io.ReadAll(r.Body)

		// The vendor decrypts what Mill sent, using its own private key.
		reqObj, err := josepkg.ParseEncrypted(string(buf), []josepkg.KeyAlgorithm{josepkg.RSA_OAEP_256}, []josepkg.ContentEncryption{josepkg.A256GCM})
		if err != nil {
			http.Error(w, "server: parse request JWE: "+err.Error(), http.StatusBadRequest)
			return
		}
		plaintext, err := reqObj.Decrypt(vendorPriv)
		if err != nil {
			http.Error(w, "server: decrypt request: "+err.Error(), http.StatusBadRequest)
			return
		}
		if string(plaintext) != `{"account":"acct-1"}` {
			http.Error(w, "server: unexpected plaintext: "+string(plaintext), http.StatusBadRequest)
			return
		}

		// The vendor encrypts its response back to Mill's own public key.
		block, _ := pem.Decode([]byte(millPubPEM))
		millPub, _ := x509.ParsePKIXPublicKey(block.Bytes)
		encrypter, _ := josepkg.NewEncrypter(josepkg.A256GCM, josepkg.Recipient{Algorithm: josepkg.RSA_OAEP_256, Key: millPub}, nil)
		respObj, _ := encrypter.Encrypt([]byte(`{"status":"approved"}`))
		respJWE, _ := respObj.CompactSerialize()

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(respJWE))
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{
			BaseURL:           srv.URL,
			AuthType:          httprequest.AuthNone,
			JOSE:              &httprequest.JOSEConfig{Enabled: true, DecryptResponse: true, RecipientPublicKeyPEM: vendorPubPEM},
			JOSEPrivateKeyPEM: millPrivPEM,
		}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "conn-1", "path": "/x", "method": http.MethodPost, "bodyTemplate": `{"account":"acct-1"}`},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	payload, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if payload != `{"status":"approved"}` {
		t.Errorf("final payload = %q, want the decrypted response %q", payload, `{"status":"approved"}`)
	}
}
