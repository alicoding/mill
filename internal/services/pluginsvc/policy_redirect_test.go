package pluginsvc

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSourcePolicyRefusesRedirectBeforeDestinationRequest(t *testing.T) {
	var destinationRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/start":
			http.Redirect(writer, request, "/final", http.StatusFound)
		case "/final":
			destinationRequests.Add(1)
			_, _ = writer.Write([]byte(`{"name":"fixture","plugins":[]}`))
		}
	}))
	defer server.Close()
	writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"url","locator":%q}]}`, server.URL+"/start"))
	svc, _ := newStoreService(t)
	_, err := svc.AddMarketplaceSource(server.URL + "/start")
	if err == nil || !strings.Contains(err.Error(), "source redirect") {
		t.Fatalf("AddMarketplaceSource error = %v", err)
	}
	if destinationRequests.Load() != 0 {
		t.Fatalf("refused destination received %d requests", destinationRequests.Load())
	}
}

func TestArtifactPolicyChecksEveryRedirectAndRecordsTerminalURL(t *testing.T) {
	archive := zipOf(t, map[string]string{
		"fixture/manifest.json": `{"id":"fixture","name":"Fixture","version":"1.0.0"}`,
		"fixture/main.js":       "export function activate() {}",
	})
	var forbiddenRequests atomic.Int32
	forbidden := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		forbiddenRequests.Add(1)
		_, _ = writer.Write(archive)
	}))
	defer forbidden.Close()
	allowed := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/archive.zip":
			http.Redirect(writer, request, "/final.zip", http.StatusFound)
		case "/final.zip":
			_, _ = writer.Write(archive)
		case "/escape.zip":
			http.Redirect(writer, request, forbidden.URL+"/plugin.zip", http.StatusFound)
		}
	}))
	defer allowed.Close()

	t.Run("terminal URL", func(t *testing.T) {
		writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"url","locator":%q,"artifactOrigins":[%q]}]}`, allowed.URL+"/archive.zip", allowed.URL))
		svc, _ := newStoreService(t)
		record, err := installLinkForTest(t, svc, allowed.URL+"/archive.zip")
		if err != nil {
			t.Fatal(err)
		}
		if record.FinalArtifactURL != allowed.URL+"/final.zip" {
			t.Fatalf("final artifact URL = %q", record.FinalArtifactURL)
		}
	})

	t.Run("refused hop", func(t *testing.T) {
		writePolicy(t, fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"url","locator":%q,"artifactOrigins":[%q]}]}`, allowed.URL+"/escape.zip", allowed.URL))
		svc, _ := newStoreService(t)
		_, err := installLinkForTest(t, svc, allowed.URL+"/escape.zip")
		if err == nil || !strings.Contains(err.Error(), "download address") {
			t.Fatalf("InstallFromLink error = %v", err)
		}
		if forbiddenRequests.Load() != 0 {
			t.Fatalf("refused artifact destination received %d requests", forbiddenRequests.Load())
		}
	})
}
