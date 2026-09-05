package clientcert_test

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/clientcert"
)

func TestValidate_NormalizesAndRequires(t *testing.T) {
	cases := map[string]struct {
		label, host string
		wantHost    string
		wantErr     bool
	}{
		"lowercases the host":     {label: "Bank", host: "  API.Example.COM ", wantHost: "api.example.com"},
		"keeps a port":            {label: "Bank", host: "api.example.com:8443", wantHost: "api.example.com:8443"},
		"drops the trailing dot":  {label: "Bank", host: "api.example.com.", wantHost: "api.example.com"},
		"leftmost wildcard":       {label: "Bank", host: "*.example.com", wantHost: "*.example.com"},
		"no label":                {label: "  ", host: "api.example.com", wantErr: true},
		"no host":                 {label: "Bank", host: "", wantErr: true},
		"wildcard not leftmost":   {label: "Bank", host: "api.*.example.com", wantErr: true},
		"partial wildcard label":  {label: "Bank", host: "*api.example.com", wantErr: true},
		"wildcard with no parent": {label: "Bank", host: "*", wantErr: true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			entity := clientcert.ClientCertificate{Label: tc.label, Host: tc.host}
			err := clientcert.Validate(&entity)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Validate(%q) = nil, want an error", tc.host)
				}
				return
			}
			if err != nil {
				t.Fatalf("Validate(%q): %v", tc.host, err)
			}
			if entity.Host != tc.wantHost {
				t.Fatalf("Host = %q, want %q", entity.Host, tc.wantHost)
			}
		})
	}
}

// The matching table the whole feature rests on: a request goes out
// with the certificate whose host pattern fits it best, and with none
// at all when nothing fits.
func TestMostSpecific(t *testing.T) {
	exact := clientcert.ClientCertificate{ID: "exact", Host: "api.example.com"}
	wildcard := clientcert.ClientCertificate{ID: "wildcard", Host: "*.example.com"}
	other := clientcert.ClientCertificate{ID: "other", Host: "*.other.com"}
	port := clientcert.ClientCertificate{ID: "port", Host: "api.example.com:8443"}
	all := []clientcert.ClientCertificate{wildcard, other, exact, port}

	cases := map[string]struct {
		authority string
		wantID    string
	}{
		"exact beats wildcard":        {authority: "api.example.com", wantID: "exact"},
		"wildcard covers a sibling":   {authority: "www.example.com", wantID: "wildcard"},
		"port entry wins on its port": {authority: "api.example.com:8443", wantID: "port"},
		"no match at all":             {authority: "api.elsewhere.com"},
		"wildcard covers one label":   {authority: "a.b.example.com"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, ok := clientcert.MostSpecific(all, tc.authority)
			if tc.wantID == "" {
				if ok {
					t.Fatalf("MostSpecific(%q) = %q, want no match", tc.authority, got.ID)
				}
				return
			}
			if !ok || got.ID != tc.wantID {
				t.Fatalf("MostSpecific(%q) = %q (ok=%v), want %q", tc.authority, got.ID, ok, tc.wantID)
			}
		})
	}
}

// A longer wildcard suffix is more specific than a shorter one, so the
// certificate meant for one department's hosts wins over the estate's.
func TestMostSpecific_LongerSuffixWins(t *testing.T) {
	broad := clientcert.ClientCertificate{ID: "broad", Host: "*.com"}
	narrow := clientcert.ClientCertificate{ID: "narrow", Host: "*.example.com"}
	got, ok := clientcert.MostSpecific([]clientcert.ClientCertificate{broad, narrow}, "api.example.com")
	if !ok || got.ID != "narrow" {
		t.Fatalf("MostSpecific = %q (ok=%v), want narrow", got.ID, ok)
	}
}

func TestStateFor(t *testing.T) {
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	cases := map[string]struct {
		notBefore, notAfter time.Time
		want                clientcert.State
	}{
		"valid for a year":  {now.AddDate(0, 0, -1), now.AddDate(1, 0, 0), clientcert.StateReady},
		"inside the window": {now.AddDate(0, 0, -1), now.AddDate(0, 0, 10), clientcert.StateExpiring},
		"already over":      {now.AddDate(-1, 0, 0), now.AddDate(0, 0, -1), clientcert.StateExpired},
		"not started yet":   {now.AddDate(0, 0, 1), now.AddDate(1, 0, 0), clientcert.StateExpired},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, _ := clientcert.StateFor(tc.notBefore, tc.notAfter, now)
			if got != tc.want {
				t.Fatalf("StateFor = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBuiltIn_CarriesNoReferences(t *testing.T) {
	for _, c := range clientcert.BuiltIn() {
		if c.CertRef != "" || c.KeyRef != "" || c.PassphraseRef != "" || c.CARef != "" {
			t.Fatalf("seeded %q names a vault entry; a vault id is per device, so a seed can never carry one", c.ID)
		}
	}
}
