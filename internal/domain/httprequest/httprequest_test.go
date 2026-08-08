package httprequest

import "testing"

func valid() HTTPRequest {
	return HTTPRequest{ID: "c1", Label: "My API", BaseURL: "https://example.com", AuthType: AuthNone}
}

func TestValidate_Accepts(t *testing.T) {
	if err := Validate(valid()); err != nil {
		t.Errorf("Validate(valid request) returned error: %v", err)
	}
}

func TestValidate_EmptyLabel_Rejected(t *testing.T) {
	r := valid()
	r.Label = "  "
	if err := Validate(r); err == nil {
		t.Error("Validate with an empty label returned nil error, want an error")
	}
}

func TestValidate_EmptyBaseURL_Rejected(t *testing.T) {
	r := valid()
	r.BaseURL = ""
	if err := Validate(r); err == nil {
		t.Error("Validate with an empty base URL returned nil error, want an error")
	}
}

func TestValidate_UnsupportedAuthType_Rejected(t *testing.T) {
	r := valid()
	// "oauth2" was this test's own example of an unsupported value
	// before ADR-0015's auth-type catalogue expansion legitimized it --
	// "saml" (never part of the researched catalogue, docs/SPEC.md
	// §4.1) is a genuinely unsupported value instead.
	r.AuthType = "saml"
	if err := Validate(r); err == nil {
		t.Error("Validate with an unsupported auth type returned nil error, want an error")
	}
}

func TestValidate_JOSEEnabledWithoutPublicKey_Rejected(t *testing.T) {
	r := valid()
	r.JOSE = &JOSEConfig{Enabled: true}
	if err := Validate(r); err == nil {
		t.Error("Validate with JOSE enabled and no recipient public key returned nil error, want an error")
	}
}

func TestValidate_JOSEEnabledWithPublicKey_Accepted(t *testing.T) {
	r := valid()
	r.JOSE = &JOSEConfig{Enabled: true, RecipientPublicKeyPEM: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
	if err := Validate(r); err != nil {
		t.Errorf("Validate with JOSE enabled and a recipient public key returned error: %v", err)
	}
}

func TestValidate_JOSEDisabled_NoPublicKeyRequired(t *testing.T) {
	r := valid()
	r.JOSE = &JOSEConfig{Enabled: false}
	if err := Validate(r); err != nil {
		t.Errorf("Validate with JOSE disabled (no public key) returned error: %v, want nil", err)
	}
}

func TestValidate_EveryAuthType_Accepted(t *testing.T) {
	for _, at := range []AuthType{
		AuthNone, AuthAPIKey, AuthBearer,
		AuthHMAC, AuthOAuth1, AuthOAuth1Vendor, AuthOAuth2, AuthQueryParam, AuthMTLS,
	} {
		r := valid()
		r.AuthType = at
		if err := Validate(r); err != nil {
			t.Errorf("Validate with AuthType %q returned error: %v", at, err)
		}
	}
}
