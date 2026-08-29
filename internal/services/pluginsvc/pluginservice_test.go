package pluginsvc

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writePlugin(t *testing.T, root, id, manifest string, extra map[string]string) {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if manifest != "" {
		if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{"main.js": "export function activate() {}"}
	for k, v := range extra {
		files[k] = v
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestListPlugins_ValidAndInvalidRows(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "good-one", `{"id":"good-one","name":"Good","version":"1.0.0","capabilities":["open-url"]}`, nil)
	writePlugin(t, root, "bad-json", `{not json`, nil)
	writePlugin(t, root, "wrong-id", `{"id":"other","name":"X","version":"1"}`, nil)
	writePlugin(t, root, "bad-cap", `{"id":"bad-cap","name":"X","version":"1","capabilities":["format-disk"]}`, nil)

	svc := New(root, nil)
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]PluginInfo{}
	for _, i := range infos {
		byID[filepath.Base(i.Dir)] = i
	}
	if got := byID["good-one"]; got.Error != "" {
		t.Fatalf("good-one should be valid, got error %q", got.Error)
	}
	if got := byID["bad-json"]; got.Error == "" {
		t.Fatal("bad-json should carry a validation error")
	}
	if got := byID["wrong-id"]; !strings.Contains(got.Error, "must match the folder") {
		t.Fatalf("wrong-id error = %q", got.Error)
	}
	if got := byID["bad-cap"]; !strings.Contains(got.Error, "unknown capability") {
		t.Fatalf("bad-cap error = %q", got.Error)
	}
}

func TestListPlugins_MissingDirIsEmptyNotError(t *testing.T) {
	svc := New(filepath.Join(t.TempDir(), "never-created"), nil)
	infos, err := svc.ListPlugins()
	if err != nil || len(infos) != 0 {
		t.Fatalf("want empty, no error; got %d infos, err %v", len(infos), err)
	}
}

func serveThrough(t *testing.T, svc *PluginService, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	handler := svc.AssetMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot) // marks "fell through to the app"
	}))
	handler.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
	return rec
}

func TestAssetMiddleware_ServesOnlyValidPluginAllowlistedFiles(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "good-one", `{"id":"good-one","name":"G","version":"1"}`, map[string]string{
		"styles.css": "body{}",
		"secret.txt": "nope",
	})
	writePlugin(t, root, "broken", `{not json`, nil)
	svc := New(root, nil)

	if rec := serveThrough(t, svc, "/plugins/good-one/main.js"); rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("main.js: code %d type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec := serveThrough(t, svc, "/plugins/good-one/styles.css"); rec.Code != http.StatusOK {
		t.Fatalf("styles.css: code %d", rec.Code)
	}
	if rec := serveThrough(t, svc, "/plugins/good-one/secret.txt"); rec.Code != http.StatusNotFound {
		t.Fatalf("non-allowlisted extension must 404, got %d", rec.Code)
	}
	if rec := serveThrough(t, svc, "/plugins/broken/main.js"); rec.Code != http.StatusNotFound {
		t.Fatalf("an invalid plugin must never serve, got %d", rec.Code)
	}
	if rec := serveThrough(t, svc, "/plugins/good-one/../../settings.json"); rec.Code != http.StatusNotFound {
		t.Fatalf("traversal must 404, got %d", rec.Code)
	}
	if rec := serveThrough(t, svc, "/anything-else"); rec.Code != http.StatusTeapot {
		t.Fatalf("non-plugin paths must fall through, got %d", rec.Code)
	}
}

func TestRequestGuardedAction_UndeclaredCapabilityRefusedBeforeRules(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "quiet-one", `{"id":"quiet-one","name":"Q","version":"1","capabilities":[]}`, nil)
	// guardrail nil: proves the refusal happens BEFORE any rule
	// evaluation could run (a nil-deref here would fail the test).
	svc := New(root, nil)
	_, err := svc.RequestGuardedAction("quiet-one", "open-url", map[string]string{"url": "https://example.com"}, "test")
	if err == nil || !strings.Contains(err.Error(), "does not declare") {
		t.Fatalf("want undeclared-capability refusal, got %v", err)
	}
}

func TestPerform_OpenURLRejectsNonHTTP(t *testing.T) {
	svc := New(t.TempDir(), nil)
	var opened string
	svc.openURL = func(u string) error { opened = u; return nil }
	if _, err := svc.perform("open-url", map[string]string{"url": "file:///etc/passwd"}); err == nil {
		t.Fatal("file: scheme must be rejected")
	}
	ok, err := svc.perform("open-url", map[string]string{"url": "https://example.com"})
	if err != nil || !ok || opened != "https://example.com" {
		t.Fatalf("https open failed: ok=%v err=%v opened=%q", ok, err, opened)
	}
}

// Ingestion claims (docs/goals/0251) fail closed the same way an
// unknown capability does: a malformed kind or extension blocks the
// load with a stated reason.
func TestListPlugins_ValidatesContributes(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "claims-ok", `{"id":"claims-ok","name":"C","version":"1","contributes":{"canvasObjects":[{"kind":"bookmark","pastesURLs":true,"fileExtensions":[".webloc"]}]}}`, nil)
	writePlugin(t, root, "bad-kind", `{"id":"bad-kind","name":"C","version":"1","contributes":{"canvasObjects":[{"kind":"Not A Slug"}]}}`, nil)
	writePlugin(t, root, "bad-ext", `{"id":"bad-ext","name":"C","version":"1","contributes":{"canvasObjects":[{"kind":"thing","fileExtensions":["webloc"]}]}}`, nil)

	svc := New(root, nil)
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]PluginInfo{}
	for _, i := range infos {
		byID[filepath.Base(i.Dir)] = i
	}
	if got := byID["claims-ok"]; got.Error != "" {
		t.Fatalf("claims-ok should be valid, got error %q", got.Error)
	}
	if got := byID["bad-kind"]; !strings.Contains(got.Error, "canvas object kind") {
		t.Fatalf("bad-kind error = %q", got.Error)
	}
	if got := byID["bad-ext"]; !strings.Contains(got.Error, "file extension") {
		t.Fatalf("bad-ext error = %q", got.Error)
	}
}

// URLPasteClaims returns only VALID plugins' claims, in id order --
// a broken manifest or one without pastesURLs never routes a paste.
func TestURLPasteClaims_ValidClaimersOnly(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "bookmarker", `{"id":"bookmarker","name":"B","version":"1","contributes":{"canvasObjects":[{"kind":"bookmark","pastesURLs":true}]}}`, nil)
	writePlugin(t, root, "no-claim", `{"id":"no-claim","name":"N","version":"1"}`, nil)
	writePlugin(t, root, "broken-claimer", `{"id":"broken-claimer","name":"X","version":"1","capabilities":["format-disk"],"contributes":{"canvasObjects":[{"kind":"thing","pastesURLs":true}]}}`, nil)

	svc := New(root, nil)
	claims := svc.URLPasteClaims()
	if len(claims) != 1 || claims[0].PluginID != "bookmarker" || claims[0].Kind != "bookmark" {
		t.Fatalf("URLPasteClaims() = %+v, want exactly bookmarker/bookmark", claims)
	}
}
