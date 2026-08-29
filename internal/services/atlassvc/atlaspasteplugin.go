package atlassvc

import (
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// PluginPasteClaim is one plugin's declared claim on bare-URL pastes
// (docs/goals/0251) as the paste chain sees it -- just the
// board-object kind to land. Which plugins are valid and enabled is
// the composition root's concern (wiring.WirePluginIngestion), never
// this package's: atlassvc must not import pluginsvc (backend.md's
// injected-func rule).
type PluginPasteClaim struct {
	Kind string
}

// WirePluginPasteClaims installs the claims lookup, called fresh on
// every paste so a plugin installed or toggled mid-session is honored
// without restart on this side.
//
//wails:ignore
func (a *AtlasService) WirePluginPasteClaims(claims func() []PluginPasteClaim) {
	a.pluginPasteClaims = claims
}

// recognizePluginURLPaste is the recognizer chain's LAST entry
// (docs/goals/0251): a single-token bare http(s) URL lands as the
// first claiming plugin's own board object, with the url-source
// contract's payload (url + title=host). Ordered after
// recognizeImagePaste so a pasted image URL still lands as an image;
// with no claims wired (or none matching) the paste falls through to
// the frontend's note fallback exactly as before, so built-in
// behavior is unchanged until a plugin actually claims URLs.
func recognizePluginURLPaste(a *AtlasService, text, _, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	if a.pluginPasteClaims == nil {
		return PasteResult{}, false, nil
	}
	candidate := strings.TrimSpace(text)
	if candidate == "" || strings.ContainsAny(candidate, " \t\n\r") {
		return PasteResult{}, false, nil
	}
	u, ok := parsedHTTPURL(candidate)
	if !ok {
		return PasteResult{}, false, nil
	}
	claims := a.pluginPasteClaims()
	if len(claims) == 0 {
		return PasteResult{}, false, nil
	}
	if _, err := a.CreateBoardObject(claims[0].Kind, map[string]string{"url": candidate, "title": u.Host}, pos, parentID); err != nil {
		return PasteResult{}, true, err
	}
	return PasteResult{Recognized: true, PluginObjects: 1}, true, nil
}
