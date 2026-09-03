package composition

import (
	"regexp"
	"testing"
)

func TestTransformText_KnownVectors(t *testing.T) {
	cases := []struct{ op, in, want string }{
		{"sha256", "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
		{"sha1", "abc", "a9993e364706816aba3e25717850c26c9cd0d89d"},
		{"md5", "abc", "900150983cd24fb0d6963f7d28e17f72"},
		{"base64-encode", "hello", "aGVsbG8="},
		{"base64-decode", "aGVsbG8=\n", "hello"},
		{"url-encode", "a b&c", "a+b%26c"},
		{"url-decode", "a+b%26c", "a b&c"},
		{"hex-encode", "hi", "6869"},
		{"hex-decode", "6869", "hi"},
		{"trim", "  x \n", "x"},
		{"upper", "MiLl", "MILL"},
		{"lower", "MiLl", "mill"},
	}
	for _, c := range cases {
		got, err := transformText(c.op, c.in)
		if err != nil {
			t.Fatalf("%s(%q): %v", c.op, c.in, err)
		}
		if got != c.want {
			t.Errorf("%s(%q) = %q, want %q", c.op, c.in, got, c.want)
		}
	}
}

func TestTransformText_DecodeErrorsNameTheOperation(t *testing.T) {
	for _, op := range []string{"base64-decode", "hex-decode", "url-decode"} {
		if _, err := transformText(op, "%zz not encoded !!"); err == nil {
			t.Errorf("%s: expected an error on malformed input", op)
		} else if !regexp.MustCompile(op).MatchString(err.Error()) {
			t.Errorf("%s: error %q does not name the operation", op, err)
		}
	}
	if _, err := transformText("rot13", "x"); err == nil {
		t.Error("unknown operation: expected an error")
	}
}

func TestTransformText_UUIDIsAFreshV4(t *testing.T) {
	a, _ := transformText("uuid", "ignored")
	b, _ := transformText("uuid", "ignored")
	re := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if !re.MatchString(a) || !re.MatchString(b) || a == b {
		t.Errorf("uuid: %q %q", a, b)
	}
}

func TestExecuteWorkflow_TransformText_HashesPayloadAndRecordsTheOperation(t *testing.T) {
	nodes := []Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "inject", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "abc", "placement": "append"}},
		{ID: "hash", NodeTypeID: "process-transform-text", Config: map[string]string{"operation": "sha256"}},
	}
	edges := []Edge{{ID: "e0", Source: "trigger", Target: "inject"}, {ID: "e1", Source: "inject", Target: "hash"}}
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	result, err := ExecuteWorkflow(resolved, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if result != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Errorf("result = %q", result)
	}
}
