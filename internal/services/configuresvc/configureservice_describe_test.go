package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// A request needing a secret the keychain lacks is summarized with its
// address, method, auth, and the missing-secret problem; storing the
// secret clears it.
func TestDescribeReference_RequestNamesTheMissingSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	r, err := cfg.CreateHTTPRequest("Jira", "https://jira.example.com", "", "", httprequest.AuthBearer, "", map[string]string{"X-Team": "ops"}, "", nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	sum, err := cfg.DescribeReference("request", r.ID)
	if err != nil {
		t.Fatalf("DescribeReference: %v", err)
	}
	if sum.Label != "Jira" || len(sum.Lines) < 4 {
		t.Fatalf("summary = %+v", sum)
	}
	byLabel := map[string]string{}
	for _, l := range sum.Lines {
		byLabel[l.Label] = l.Value
	}
	if byLabel["Address"] != "https://jira.example.com" || byLabel["Method"] != "GET" || byLabel["Auth"] != "Bearer token" || byLabel["Secret"] != "Missing" {
		t.Fatalf("lines = %v", byLabel)
	}
	if len(sum.Problems) != 1 || !strings.Contains(sum.Problems[0], "No secret is stored") {
		t.Fatalf("problems = %v", sum.Problems)
	}
	storeRequestSecret(t, cfg, r.ID, "pat-123")
	sum, _ = cfg.DescribeReference("request", r.ID)
	if len(sum.Problems) != 0 {
		t.Fatalf("after storing the secret, problems = %v", sum.Problems)
	}
	for _, l := range sum.Lines {
		if l.Label == "Secret" && l.Value != "Stored" {
			t.Fatalf("secret line = %q", l.Value)
		}
	}
}

func TestDescribeReference_ListAndUnknowns(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Countries", "", []typedfield.Field{{Key: "code", Label: "Code", Type: typedfield.TypeText}, {Key: "name", Label: "Name", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatal(err)
	}
	sum, err := cfg.DescribeReference("list", l.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Label != "Countries" || sum.Lines[0].Value != "Code, Name" || sum.Lines[1].Value != "0" {
		t.Fatalf("list summary = %+v", sum)
	}
	if _, err := cfg.DescribeReference("list", "nope"); err == nil || !strings.Contains(err.Error(), `no list with id "nope"`) {
		t.Fatalf("unknown id err = %v", err)
	}
	if _, err := cfg.DescribeReference("teapot", l.ID); err == nil || !strings.Contains(err.Error(), "no summary") {
		t.Fatalf("unknown kind err = %v", err)
	}
}
