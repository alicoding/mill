package remoteauthsvc

import "testing"

// TestGenerateCode_UsesOnlyUnambiguousAlphabet pins the pairing code's
// hand-typed-on-a-phone requirement: no character a person could
// misread for another (0/O, 1/I/L) ever appears.
func TestGenerateCode_UsesOnlyUnambiguousAlphabet(t *testing.T) {
	const ambiguous = "0O1IL"
	for i := 0; i < 200; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode() = %v, want nil error", err)
		}
		if len(code) != pairingCodeLength {
			t.Fatalf("generateCode() = %q, want length %d", code, pairingCodeLength)
		}
		for _, r := range code {
			for _, bad := range ambiguous {
				if r == bad {
					t.Fatalf("generateCode() = %q, contains ambiguous character %q", code, bad)
				}
			}
		}
	}
}

func TestGenerateCode_IsNotConstant(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode() = %v, want nil error", err)
		}
		seen[code] = true
	}
	if len(seen) < 2 {
		t.Fatalf("generateCode() produced only %d distinct value(s) over 20 draws, want randomness", len(seen))
	}
}
