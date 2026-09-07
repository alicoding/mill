package audit

import "testing"

func TestValidateAttributes_AcceptsAllowedKeys(t *testing.T) {
	for kind, keys := range AllowedAttributes {
		attrs := map[string]string{}
		for _, k := range keys {
			attrs[k] = "x"
		}
		if err := ValidateAttributes(kind, attrs); err != nil {
			t.Errorf("kind %q: every allowed key rejected: %v", kind, err)
		}
	}
}

// TestValidateAttributes_RejectsSecretShapedKeys is goal 0351 Decision
// 1's own gate: an audit row must never carry secret material, so a
// producer that tries to smuggle a value/password/token/secret key
// into Attributes must be rejected for every kind, not just the ones
// with a populated allowlist today.
func TestValidateAttributes_RejectsSecretShapedKeys(t *testing.T) {
	for _, kind := range []Kind{KindMCPCall, KindSecretAccess, KindBridgeCommand} {
		for _, key := range []string{"value", "password", "token", "secret", "body", "response_body"} {
			if err := ValidateAttributes(kind, map[string]string{key: "x"}); err == nil {
				t.Errorf("kind %q: attribute key %q was accepted, want rejected", kind, key)
			}
		}
	}
}

func TestValidateAttributes_UnknownKindHasEmptyAllowlist(t *testing.T) {
	if err := ValidateAttributes(Kind("unknown"), map[string]string{"anything": "x"}); err == nil {
		t.Error("an unregistered kind should reject every attribute key, got nil error")
	}
	if err := ValidateAttributes(Kind("unknown"), nil); err != nil {
		t.Errorf("an unregistered kind with no attributes should pass, got: %v", err)
	}
}
