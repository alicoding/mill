package bridgesvc

import (
	"net/http"

	"github.com/alicoding/mill/internal/domain/browserbridge"
)

// testPageHTML is the page "Test the connection" replays against. Mill
// serves it itself so the test never depends on a site being up, and
// its markup can never change under the flow: the two ids here are the
// same constants browserbridge.TestFlow selects on.
//
// The button reveals the ready element rather than the page rendering
// it up front -- a wait that could pass without the click having landed
// would prove nothing about the click.
const testPageHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mill connection test</title>
<style>
 body { font: 15px/1.5 system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; }
 button { font: inherit; padding: .4rem .9rem; }
 #` + browserbridge.TestPageReadyID + ` { margin-top: 1rem; font-weight: 600; }
</style>
</head>
<body>
<h1>Mill connection test</h1>
<p>Mill is checking that it can drive this browser. Nothing here is saved.</p>
<button id="` + browserbridge.TestPageButtonID + `" aria-label="Confirm the connection">Confirm the connection</button>
<div id="` + browserbridge.TestPageReadyID + `" hidden>Connected</div>
<script>
 document.getElementById('` + browserbridge.TestPageButtonID + `').addEventListener('click', function () {
   document.getElementById('` + browserbridge.TestPageReadyID + `').hidden = false;
 });
</script>
</body>
</html>
`

// handleTestPage serves the connection test's page. No token: a tab
// about to load a URL cannot send an Authorization header, and the page
// carries no data -- loopback is the whole gate here.
func (s *BridgeService) handleTestPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopback(r) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(testPageHTML))
}
