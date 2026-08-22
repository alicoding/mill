package remoteauthsvc

import (
	"html/template"
	"io"
	"time"
)

// Pairing-page copy (.claude/rules/ux-writing.md: front-load the
// action, plain language, no internal references). Every branch of
// handlePairSubmit maps to exactly one of these.
const (
	pairingErrorWrongCode = "That code did not work. Check it and try again."
	pairingErrorGeneric   = "Something went wrong. Try again."
)

// pairingLockoutMessage turns a rate-limit wait into one plain
// sentence -- exact seconds remaining isn't useful to a person typing
// a code, so this buckets rather than counts down.
func pairingLockoutMessage(retryAfter time.Duration) string {
	if retryAfter <= 90*time.Second {
		return "Too many attempts. Wait a minute, then try again."
	}
	return "Too many attempts. Wait a few minutes, then try again."
}

// pairingPageState is the pairing page's only variable content.
type pairingPageState struct {
	ErrorMessage string
}

// pairingPageTemplate is the standalone page an unpaired non-loopback
// request always gets (SLICE 1 DESIGN CONTRACT: "never the app,
// never a partial app shell"). Fully self-contained -- inline style,
// a plain HTML form, no script and no external request -- so it
// renders correctly with nothing else served yet.
var pairingPageTemplate = template.Must(template.New("pairing").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair this device</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; min-height: 100vh; margin: 0;
    align-items: center; justify-content: center;
    background: #f6f8fa; color: #1f2328;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    .card { background: #161b22 !important; border-color: #30363d !important; }
    input { background: #0d1117 !important; color: #e6edf3 !important; border-color: #30363d !important; }
  }
  .card {
    background: #fff; border: 1px solid #d0d7de; border-radius: 12px;
    padding: 32px; width: 320px; text-align: center;
  }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  input {
    width: 100%; box-sizing: border-box; font-size: 20px; letter-spacing: 0.15em;
    text-align: center; text-transform: uppercase; padding: 10px;
    border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 16px;
  }
  button {
    width: 100%; font-size: 14px; font-weight: 600; padding: 10px;
    border: none; border-radius: 8px; background: #1f883d; color: #fff; cursor: pointer;
  }
  .error { color: #cf222e; font-size: 13px; margin: 0 0 16px; }
  @media (prefers-color-scheme: dark) { .error { color: #f85149; } }
</style>
</head>
<body>
  <div class="card">
    <h1>Pair this device</h1>
    <p>Enter the code shown in Mill on your Mac.</p>
    {{if .ErrorMessage}}<p class="error">{{.ErrorMessage}}</p>{{end}}
    <form method="post" action="{{.SubmitPath}}">
      <input type="text" name="{{.FormKey}}" maxlength="8" autocomplete="off" autofocus placeholder="8-character code" required>
      <button type="submit">Pair device</button>
    </form>
  </div>
</body>
</html>
`))

// writePairingPage renders the pairing page to w.
func writePairingPage(w io.Writer, state pairingPageState) {
	_ = pairingPageTemplate.Execute(w, struct {
		pairingPageState
		SubmitPath string
		FormKey    string
	}{state, PairSubmitPath, pairingCodeFormKey})
}
