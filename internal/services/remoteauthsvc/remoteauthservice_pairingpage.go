package remoteauthsvc

import (
	"fmt"
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

// pairingInstructionsServer and pairingInstructionsDesktop are the
// SLICE 2 DESIGN CONTRACT's per-mode copy: the browser cannot tell a
// headless server from a desktop build, so the server names the
// channel for its own deployment instead of one sentence that is
// wrong for half of them.
const (
	pairingInstructionsServer  = "Find the pairing code in this server's log."
	pairingInstructionsDesktop = "Open Settings → Remote access on your Mac to see the code."
)

// resendConfirmationServer and resendConfirmationDesktop are the
// per-mode confirmation shown after a successful "Get a new code"
// action -- same reasoning as the instructions above.
const (
	resendConfirmationServer  = "A new code is in this server's log."
	resendConfirmationDesktop = "A new code is showing in Settings → Remote access."
)

// pairingInstructions returns the truthful, mode-specific sentence
// telling a pairing device where to find its code.
func (s *RemoteAuthService) pairingInstructions() string {
	if s.serverMode {
		return pairingInstructionsServer
	}
	return pairingInstructionsDesktop
}

// resendConfirmation returns the truthful, mode-specific sentence
// confirming a successful resend.
func (s *RemoteAuthService) resendConfirmation() string {
	if s.serverMode {
		return resendConfirmationServer
	}
	return resendConfirmationDesktop
}

// pairingDurationMessage is the SLICE 2 DESIGN CONTRACT item 3
// disclosure, derived from the real cookieLifetime constant so it can
// never silently drift from what the code actually does.
var pairingDurationMessage = fmt.Sprintf(
	"Once paired, this device stays signed in for %s. You can revoke it anytime in Settings.",
	humanizeDuration(cookieLifetime),
)

// humanizeDuration renders d as a whole, person-readable span (days/
// weeks/months/years) -- an approximation for pairing-page copy, not
// a precise countdown.
func humanizeDuration(d time.Duration) string {
	days := int(d.Hours() / 24)
	switch {
	case days >= 365:
		return pluralizeUnit(days/365, "year")
	case days >= 30:
		return pluralizeUnit(days/30, "month")
	case days >= 7:
		return pluralizeUnit(days/7, "week")
	default:
		return pluralizeUnit(days, "day")
	}
}

func pluralizeUnit(n int, unit string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", unit)
	}
	return fmt.Sprintf("%d %ss", n, unit)
}

// pairingLockoutMessage turns a rate-limit wait into one plain
// sentence -- exact seconds remaining isn't useful to a person typing
// a code, so this buckets rather than counts down.
func pairingLockoutMessage(retryAfter time.Duration) string {
	if retryAfter <= 90*time.Second {
		return "Too many attempts. Wait a minute, then try again."
	}
	return "Too many attempts. Wait a few minutes, then try again."
}

// pairingPageState is the pairing page's caller-supplied variable
// content -- Instructions and DurationMessage are filled in by
// writePairingResponse from service state, never by callers directly.
type pairingPageState struct {
	ErrorMessage string
	InfoMessage  string
	Instructions string
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
  .secondary {
    background: transparent; color: #1f883d; border: 1px solid #d0d7de;
    margin-top: 8px;
  }
  @media (prefers-color-scheme: dark) { .secondary { color: #3fb950; } }
  .error { color: #cf222e; font-size: 13px; margin: 0 0 16px; }
  @media (prefers-color-scheme: dark) { .error { color: #f85149; } }
  .info { color: #1f883d; font-size: 13px; margin: 0 0 16px; }
  @media (prefers-color-scheme: dark) { .info { color: #3fb950; } }
  .duration { font-size: 12px; color: #59636e; margin: 20px 0 0; }
  @media (prefers-color-scheme: dark) { .duration { color: #8b949e; } }
</style>
</head>
<body>
  <div class="card">
    <h1>Pair this device</h1>
    <p>{{.Instructions}}</p>
    {{if .ErrorMessage}}<p class="error">{{.ErrorMessage}}</p>{{end}}
    {{if .InfoMessage}}<p class="info">{{.InfoMessage}}</p>{{end}}
    <form method="post" action="{{.SubmitPath}}">
      <input type="text" name="{{.FormKey}}" maxlength="8" autocomplete="off" autofocus placeholder="8-character code" required>
      <button type="submit">Pair device</button>
    </form>
    <form method="post" action="{{.ResendPath}}">
      <button type="submit" class="secondary">Get a new code</button>
    </form>
    <p class="duration">{{.DurationMessage}}</p>
  </div>
</body>
</html>
`))

// writePairingPage renders the pairing page to w.
func writePairingPage(w io.Writer, state pairingPageState) {
	_ = pairingPageTemplate.Execute(w, struct {
		pairingPageState
		SubmitPath      string
		FormKey         string
		ResendPath      string
		DurationMessage string
	}{state, PairSubmitPath, pairingCodeFormKey, ResendSubmitPath, pairingDurationMessage})
}
