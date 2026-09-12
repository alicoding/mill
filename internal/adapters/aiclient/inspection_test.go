package aiclient

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestInspectOpenAICompatible_UsesConfiguredProtocolAndKeepsOperationsUnproven(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAuth = r.URL.Path, r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a","owned_by":"ignored"},{"id":"model-b"}],"object":"list"}`))
	}))
	defer srv.Close()

	got, err := Inspect(InspectionRequest{
		Kind: KindOpenAICompat, BaseURL: srv.URL + "/prefix", Model: "model-b", APIKey: "test-key",
	})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if gotPath != "/prefix/v1/models" || gotAuth != "Bearer test-key" {
		t.Fatalf("request path=%q Authorization=%q", gotPath, gotAuth)
	}
	if got.Transport != "responded" || got.Inspection != "available" || got.Authentication != "metadata-authorized" {
		t.Fatalf("result = %+v", got)
	}
	if got.SelectedFound == nil || !*got.SelectedFound || strings.Join(got.Models, ",") != "model-a,model-b" {
		t.Fatalf("models result = %+v", got)
	}
	if got.Endpoint != srv.URL+"/prefix/v1/models" {
		t.Fatalf("Endpoint = %q", got.Endpoint)
	}
}

func TestInspectOpenAICompatible_MetadataOutcomes(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		model      string
		inspection string
		auth       string
		reason     string
		found      *bool
	}{
		{name: "unsupported", status: http.StatusNotFound, inspection: "unsupported", auth: "unknown", reason: "metadata-api-unsupported"},
		{name: "malformed", status: http.StatusOK, body: `{"data":`, model: "m", inspection: "failed", auth: "unknown", reason: "metadata-response-malformed"},
		{name: "rejected", status: http.StatusUnauthorized, inspection: "failed", auth: "rejected", reason: "metadata-auth-rejected"},
		{name: "missing model", status: http.StatusOK, body: `{"data":[{"id":"other"}]}`, model: "m", inspection: "available", auth: "not-required", reason: "selected-model-not-listed", found: boolPointer(false)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer srv.Close()
			got, err := Inspect(InspectionRequest{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: tt.model})
			if err != nil {
				t.Fatalf("Inspect: %v", err)
			}
			if got.Inspection != tt.inspection || got.Authentication != tt.auth || !containsString(got.ReasonCodes, tt.reason) {
				t.Fatalf("result = %+v", got)
			}
			if tt.found != nil && (got.SelectedFound == nil || *got.SelectedFound != *tt.found) {
				t.Fatalf("SelectedFound = %v, want %v", got.SelectedFound, *tt.found)
			}
		})
	}
}

func TestInspectAnthropic_PartialListRetrievesSelectedModel(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		if got := r.Header.Get("x-api-key"); got != "anthropic-test-key" {
			t.Errorf("x-api-key = %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != "2023-06-01" {
			t.Errorf("anthropic-version = %q", got)
		}
		switch r.URL.Path {
		case "/proxy/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"model-a","capabilities":null}],"first_id":"model-a","last_id":"model-a","has_more":true}`))
		case "/proxy/v1/models/model-b":
			_, _ = w.Write([]byte(`{"id":"model-b","capabilities":{"structured_outputs":{"supported":true}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	got, err := Inspect(InspectionRequest{Kind: KindAnthropic, BaseURL: srv.URL + "/proxy", Model: "model-b", APIKey: "anthropic-test-key"}) //nolint:gosec // An httptest-only sentinel, never a credential.
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if strings.Join(paths, ",") != "/proxy/v1/models?limit=1000,/proxy/v1/models/model-b" {
		t.Fatalf("paths = %v", paths)
	}
	if got.SelectedFound == nil || !*got.SelectedFound || got.InventoryComplete {
		t.Fatalf("result = %+v", got)
	}
	if strings.Join(got.Models, ",") != "model-a,model-b" {
		t.Fatalf("Models = %v", got.Models)
	}
}

func TestInspectAnthropic_DistinguishesIncompleteInventoryFromMissingModel(t *testing.T) {
	tests := []struct {
		name           string
		hasMore        bool
		retrieveStatus int
		wantFound      *bool
		wantReason     string
	}{
		{name: "incomplete and retrieve unsupported", hasMore: true, retrieveStatus: http.StatusMethodNotAllowed, wantReason: "metadata-inventory-incomplete"},
		{name: "incomplete and retrieve proves missing", hasMore: true, retrieveStatus: http.StatusNotFound, wantFound: boolPointer(false), wantReason: "selected-model-missing"},
		{name: "complete and retrieve unsupported", hasMore: false, retrieveStatus: http.StatusMethodNotAllowed, wantReason: "selected-model-unverified"},
		{name: "complete list and retrieve proves missing", hasMore: false, retrieveStatus: http.StatusNotFound, wantFound: boolPointer(false), wantReason: "selected-model-missing"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/models" {
					_, _ = w.Write([]byte(`{"data":[{"id":"other"}],"first_id":"other","last_id":"other","has_more":` + boolText(tt.hasMore) + `}`))
					return
				}
				w.WriteHeader(tt.retrieveStatus)
			}))
			defer srv.Close()
			got, err := Inspect(InspectionRequest{Kind: KindAnthropic, BaseURL: srv.URL, Model: "wanted"})
			if err != nil {
				t.Fatalf("Inspect: %v", err)
			}
			if tt.wantFound == nil && got.SelectedFound != nil {
				t.Fatalf("SelectedFound = %v, want unknown", *got.SelectedFound)
			}
			if tt.wantFound != nil && (got.SelectedFound == nil || *got.SelectedFound != *tt.wantFound) {
				t.Fatalf("SelectedFound = %v, want %v", got.SelectedFound, *tt.wantFound)
			}
			if tt.retrieveStatus == http.StatusMethodNotAllowed {
				if got.Inspection != "available" || !containsString(got.ReasonCodes, "metadata-available") {
					t.Fatalf("result = %+v", got)
				}
			} else if !containsString(got.ReasonCodes, tt.wantReason) {
				t.Fatalf("result = %+v", got)
			}
		})
	}
}

func TestInspectOpenAICompatible_TruncatedDisplayStillFindsSelectedModel(t *testing.T) {
	var body strings.Builder
	body.WriteString(`{"data":[`)
	for i := 0; i <= inspectionModelLimit; i++ {
		if i > 0 {
			body.WriteByte(',')
		}
		_, _ = fmt.Fprintf(&body, `{"id":"model-%d"}`, i)
	}
	body.WriteString(`]}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body.String())) }))
	defer srv.Close()

	got, err := Inspect(InspectionRequest{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "model-1000"})
	if err != nil || got.SelectedFound == nil || !*got.SelectedFound || got.InventoryComplete || len(got.Models) != inspectionModelLimit {
		t.Fatalf("result=%+v err=%v", got, err)
	}
}

func TestInspectOpenAICompatible_TruncatedDisplayKeepsAbsentSelectionUnknown(t *testing.T) {
	var body strings.Builder
	body.WriteString(`{"data":[`)
	for i := 0; i <= inspectionModelLimit; i++ {
		if i > 0 {
			body.WriteByte(',')
		}
		_, _ = fmt.Fprintf(&body, `{"id":"model-%d"}`, i)
	}
	body.WriteString(`]}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body.String())) }))
	defer srv.Close()

	got, err := Inspect(InspectionRequest{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "not-in-bounded-inventory"})
	if err != nil || got.SelectedFound != nil || got.InventoryComplete || len(got.Models) != inspectionModelLimit || !containsString(got.ReasonCodes, "metadata-inventory-incomplete") || containsString(got.ReasonCodes, "selected-model-not-listed") {
		t.Fatalf("result=%+v err=%v", got, err)
	}
}

func TestInspectAnthropic_CompleteListRetrievesAliasAndEncodesItOnce(t *testing.T) {
	const alias = "claude/alias ?#%"
	var requests []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.RequestURI())
		if r.URL.Path == "/v1/models" {
			_, _ = w.Write([]byte(`{"data":[{"id":"other"}],"first_id":"other","last_id":"other","has_more":false}`))
			return
		}
		if r.RequestURI != "/v1/models/claude%2Falias%20%3F%23%25" {
			t.Errorf("retrieve request URI = %q", r.RequestURI)
		}
		_, _ = w.Write([]byte(`{"id":"claude-canonical-20260910"}`))
	}))
	defer srv.Close()

	got, err := Inspect(InspectionRequest{Kind: KindAnthropic, BaseURL: srv.URL, Model: alias})
	if err != nil || got.SelectedFound == nil || !*got.SelectedFound || got.Inspection != "available" {
		t.Fatalf("result=%+v err=%v", got, err)
	}
	if len(requests) != 2 || strings.Contains(requests[1], "%252F") {
		t.Fatalf("requests = %v", requests)
	}
	if containsModel(got.Models, alias) || !containsModel(got.Models, "claude-canonical-20260910") {
		t.Fatalf("configured alias was rewritten or canonical choice omitted: %v", got.Models)
	}
}

func TestInspect_RejectsBlankModelIDsInsteadOfProvingAbsence(t *testing.T) {
	for _, kind := range []Kind{KindOpenAICompat, KindAnthropic} {
		for _, invalid := range []string{`{}`, `{"id":" "}`} {
			name := string(kind) + "/missing"
			if strings.Contains(invalid, "id") {
				name = string(kind) + "/blank"
			}
			t.Run(name, func(t *testing.T) {
				body := `{"data":[{"id":"valid"},` + invalid + `]}`
				if kind == KindAnthropic {
					body = `{"data":[{"id":"valid"},` + invalid + `],"first_id":"valid","last_id":"valid","has_more":false}`
				}
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
				defer srv.Close()
				got, err := Inspect(InspectionRequest{Kind: kind, BaseURL: srv.URL, Model: "wanted"})
				if err != nil || got.Inspection != "failed" || got.SelectedFound != nil || !containsString(got.ReasonCodes, "metadata-response-malformed") {
					t.Fatalf("result=%+v err=%v", got, err)
				}
			})
		}
	}
}

func TestInspect_ResponseLimitsRedirectsAndTimeouts(t *testing.T) {
	t.Run("oversize", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(strings.Repeat("x", inspectionBodyLimit+1)))
		}))
		defer srv.Close()
		got, err := Inspect(InspectionRequest{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m"})
		if err != nil || got.Transport != "responded" || !containsString(got.ReasonCodes, "metadata-response-too-large") {
			t.Fatalf("result=%+v err=%v", got, err)
		}
	})

	t.Run("redirect", func(t *testing.T) {
		var destinationCalls int
		destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { destinationCalls++ }))
		defer destination.Close()
		source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
		}))
		defer source.Close()
		got, err := Inspect(InspectionRequest{Kind: KindOpenAICompat, BaseURL: source.URL, Model: "m", APIKey: "must-not-move"})
		if err != nil || !containsString(got.ReasonCodes, "metadata-redirect-refused") || destinationCalls != 0 {
			t.Fatalf("result=%+v destinationCalls=%d err=%v", got, destinationCalls, err)
		}
	})

	t.Run("timeout", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		}))
		defer srv.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
		defer cancel()
		_, err := Inspect(InspectionRequest{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m", Context: ctx})
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error = %v, want deadline exceeded", err)
		}
	})
}

func TestInspect_InvalidConfigurationNeverCallsNetwork(t *testing.T) {
	got, err := Inspect(InspectionRequest{Kind: KindOpenAICompat, BaseURL: "https://user:secret@example.com?token=secret", Model: "m"})
	if err != nil || got.Transport != "invalid-configuration" || got.Endpoint != "" || !containsString(got.ReasonCodes, "invalid-endpoint") {
		t.Fatalf("result=%+v err=%v", got, err)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func boolText(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
