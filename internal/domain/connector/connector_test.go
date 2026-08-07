package connector

import "testing"

func valid() Connector {
	return Connector{ID: "c1", Label: "My API", Type: TypeHTTP, BaseURL: "https://example.com", AuthType: AuthNone}
}

func TestValidate_Accepts(t *testing.T) {
	if err := Validate(valid()); err != nil {
		t.Errorf("Validate(valid connector) returned error: %v", err)
	}
}

func TestValidate_EmptyLabel_Rejected(t *testing.T) {
	c := valid()
	c.Label = "  "
	if err := Validate(c); err == nil {
		t.Error("Validate with an empty label returned nil error, want an error")
	}
}

func TestValidate_UnsupportedType_Rejected(t *testing.T) {
	c := valid()
	c.Type = "soap"
	if err := Validate(c); err == nil {
		t.Error("Validate with an unsupported type returned nil error, want an error")
	}
}

func TestValidate_EmptyBaseURL_Rejected(t *testing.T) {
	c := valid()
	c.BaseURL = ""
	if err := Validate(c); err == nil {
		t.Error("Validate with an empty base URL returned nil error, want an error")
	}
}

func TestValidate_UnsupportedAuthType_Rejected(t *testing.T) {
	c := valid()
	c.AuthType = "oauth2"
	if err := Validate(c); err == nil {
		t.Error("Validate with an unsupported auth type returned nil error, want an error")
	}
}

func TestValidate_EveryAuthType_Accepted(t *testing.T) {
	for _, at := range []AuthType{AuthNone, AuthAPIKey, AuthBearer} {
		c := valid()
		c.AuthType = at
		if err := Validate(c); err != nil {
			t.Errorf("Validate with AuthType %q returned error: %v", at, err)
		}
	}
}
