package pluginsvc

import (
	"fmt"
	"regexp"
	"strings"
)

// conformSetEditingNeedsInteractive is standard rule 22: ctx.setEditing
// is handed to a canvas face only when its declaration says
// content: 'interactive', so a script that calls it under the default
// static declaration reports an editor nothing ever reads. A source
// scan, the same shape rule 9 uses: the declaration lives in the
// plugin's own JavaScript, which no manifest can be read for.
func conformSetEditingNeedsInteractive(scripts map[string]string) []string {
	var warnings []string
	for rel, src := range scripts {
		if !strings.Contains(src, "setEditing") {
			continue
		}
		if interactiveContentRe.MatchString(src) {
			continue
		}
		warnings = append(warnings, fmt.Sprintf("standard rule 22: %s calls setEditing, so its canvas object must declare content: \"interactive\"", rel))
	}
	return warnings
}

// interactiveContentRe matches the declaration in either quoting style
// a plugin may write it in, with or without spacing around the colon.
var interactiveContentRe = regexp.MustCompile(`content\s*:\s*['"]interactive['"]`)
