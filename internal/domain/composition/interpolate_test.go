package composition

import (
	"reflect"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

func TestInterpolate_SubstitutesWhitespaceToleratesAndEscapes(t *testing.T) {
	vars := map[string]string{"API_BASE": "https://example.test", "_x1": "v"}
	cases := []struct {
		name, in, want string
		missing        []string
	}{
		{name: "plain reference", in: "{{API_BASE}}/get", want: "https://example.test/get"},
		{name: "whitespace inside the braces", in: "{{  API_BASE }}/get", want: "https://example.test/get"},
		{name: "repeated reference", in: "{{API_BASE}}|{{API_BASE}}", want: "https://example.test|https://example.test"},
		{name: "underscore and digits in the name", in: "{{_x1}}", want: "v"},
		{name: "escaped braces stay literal", in: `\{{API_BASE}}`, want: "{{API_BASE}}"},
		{name: "missing key is left as written", in: "{{NOPE}}/x", want: "{{NOPE}}/x", missing: []string{"NOPE"}},
		{name: "a name that is not an identifier is literal text", in: "{{not a key}}", want: "{{not a key}}"},
		{name: "unclosed braces are literal text", in: `{"a": {{`, want: `{"a": {{`},
		{name: "json braces are untouched", in: `{"a":{"b":1}}`, want: `{"a":{"b":1}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, missing := Interpolate(tc.in, vars)
			if got != tc.want {
				t.Errorf("Interpolate(%q) = %q, want %q", tc.in, got, tc.want)
			}
			if len(missing) != len(tc.missing) || (len(missing) > 0 && !reflect.DeepEqual(missing, tc.missing)) {
				t.Errorf("Interpolate(%q) missing = %v, want %v", tc.in, missing, tc.missing)
			}
		})
	}
}

func TestInterpolate_NoEnvironmentMakesEveryReferenceMissing(t *testing.T) {
	got, missing := Interpolate("{{A}}/{{B}}/{{A}}", nil)
	if got != "{{A}}/{{B}}/{{A}}" {
		t.Errorf("Interpolate with no variables = %q, want the input unchanged", got)
	}
	if !reflect.DeepEqual(missing, []string{"A", "B"}) {
		t.Errorf("missing = %v, want [A B] in first-appearance order, deduplicated", missing)
	}
}

func TestVarRefs_ListsEachNameOnceInOrder(t *testing.T) {
	if got := VarRefs("{{B}}{{A}}{{B}}"); !reflect.DeepEqual(got, []string{"B", "A"}) {
		t.Errorf("VarRefs = %v, want [B A]", got)
	}
	if got := VarRefs(`\{{B}}`); len(got) != 0 {
		t.Errorf("VarRefs on an escaped reference = %v, want none", got)
	}
}

func TestInterpolateRequest_CoversURLBodyHeadersAndPlainAuthFields(t *testing.T) {
	// #nosec G101 -- a scope and a token ENDPOINT, both templated; no credential is present.
	auth := httprequest.AuthConfig{OAuth2: &httprequest.OAuth2Config{Scope: "{{STAGE}}.read", TokenURL: "{{API_BASE}}/token"}}
	rc := ResolvedHTTPRequest{
		BaseURL: "{{API_BASE}}/v1",
		Body:    `{"stage":"{{STAGE}}"}`,
		Headers: map[string]string{"X-Stage": "{{STAGE}}", "X-Fixed": "always"},
		Auth:    &auth,
	}
	vars := map[string]string{"API_BASE": "https://example.test", "STAGE": "sandbox"}
	got, missing := InterpolateRequest(rc, vars)
	if got.BaseURL != "https://example.test/v1" {
		t.Errorf("BaseURL = %q", got.BaseURL)
	}
	if got.Body != `{"stage":"sandbox"}` {
		t.Errorf("Body = %q", got.Body)
	}
	if got.Headers["X-Stage"] != "sandbox" || got.Headers["X-Fixed"] != "always" {
		t.Errorf("Headers = %v", got.Headers)
	}
	if got.Auth.OAuth2.Scope != "sandbox.read" {
		t.Errorf("OAuth2 scope = %q, want the substituted value", got.Auth.OAuth2.Scope)
	}
	if rc.Auth.OAuth2.Scope != "{{STAGE}}.read" {
		t.Error("InterpolateRequest edited the caller's own AuthConfig -- a run must never write to configuration")
	}
	if len(missing) != 0 {
		t.Errorf("missing = %v, want none", missing)
	}
}

func TestRequestVarRefs_ReadsTheSameFieldsInterpolateRequestWrites(t *testing.T) {
	rc := ResolvedHTTPRequest{
		BaseURL: "{{API_BASE}}/v1",
		Body:    "{{BODY_VAR}}",
		Headers: map[string]string{"X-Stage": "{{STAGE}}"},
	}
	got := RequestVarRefs(rc)
	want := map[string]bool{"API_BASE": true, "BODY_VAR": true, "STAGE": true}
	if len(got) != len(want) {
		t.Fatalf("RequestVarRefs = %v, want exactly %v", got, want)
	}
	for _, k := range got {
		if !want[k] {
			t.Errorf("RequestVarRefs returned unexpected %q", k)
		}
	}
}
