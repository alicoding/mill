package pluginsvc

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// The plugin standard's rule 21 (userdocs/reference/plugin-standard.md,
// docs/goals/0349): a view or capture with its own UI declares an
// entry page, and that page loads only files from the plugin folder.
// Split from conform_standard.go at the hand-written-file line limit
// (.claude/rules/architecture.md).

// entryResourceRe finds every src=/href= value an entry page loads.
// RE2 has no backreference, so the two quote styles and the unquoted
// form are three alternatives rather than one capture reused as a
// closing delimiter.
var entryResourceRe = regexp.MustCompile(`(?i)\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)

// conformEntryPages is standard rule 21's checkable half: an entry
// page loads only files from the plugin's own folder. The frame's
// Content-Security-Policy already refuses anything else at runtime;
// this tells the author at build time, where a blocked stylesheet is
// a one-line fix rather than a silent blank panel.
func conformEntryPages(dir string, m Manifest) []string {
	var problems []string
	for _, entry := range declaredEntries(m) {
		raw, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(entry.file))) // #nosec G304 G703 -- entry.file passed entryPathProblem, under the caller's own plugin folder
		if err != nil {
			problems = append(problems, fmt.Sprintf("standard rule 21: %s %q entry %q is missing or unreadable", entry.kind, entry.id, entry.file))
			continue
		}
		for _, ref := range entryRemoteRefs(string(raw)) {
			problems = append(problems, fmt.Sprintf("standard rule 21: %s: %q is not a file in the plugin folder", entry.file, ref))
		}
		problems = append(problems, entryInlineScriptProblems(entry.file, string(raw))...)
	}
	return problems
}

// conformSurfacesWithoutEntry is standard rule 21's advisory half: a
// view or capture with no entry page draws into Mill's own document
// instead of its own frame. It still works; the author is told the
// framed form exists, which is the one that survives a Mill upgrade
// unchanged.
func conformSurfacesWithoutEntry(m Manifest) []string {
	var warnings []string
	for _, v := range m.Contributes.Views {
		if v.Entry == "" {
			warnings = append(warnings, fmt.Sprintf("standard rule 21: view %q declares no entry page, so it renders in Mill's own document", v.ID))
		}
	}
	for _, c := range m.Contributes.Captures {
		if c.Entry == "" {
			warnings = append(warnings, fmt.Sprintf("standard rule 21: capture %q declares no entry page, so it renders in Mill's own document", c.ID))
		}
	}
	return warnings
}

type declaredEntry struct {
	kind string
	id   string
	file string
}

func declaredEntries(m Manifest) []declaredEntry {
	var out []declaredEntry
	for _, v := range m.Contributes.Views {
		if v.Entry != "" {
			out = append(out, declaredEntry{kind: "view", id: v.ID, file: v.Entry})
		}
	}
	for _, c := range m.Contributes.Captures {
		if c.Entry != "" {
			out = append(out, declaredEntry{kind: "capture", id: c.ID, file: c.Entry})
		}
	}
	for _, o := range m.Contributes.CanvasObjects {
		if o.Entry != "" {
			out = append(out, declaredEntry{kind: "canvas object", id: o.Kind, file: o.Entry})
		}
	}
	return out
}

// entryRemoteRefs returns every referenced URL that is not a plain
// relative path inside the folder. A fragment, an inline data: URI and
// a relative path are the three legal shapes; a scheme, a
// protocol-relative host and a parent-directory step are not.
func entryRemoteRefs(html string) []string {
	var refs []string
	for _, match := range entryResourceRe.FindAllStringSubmatch(html, -1) {
		value := ""
		for _, g := range match[1:] {
			if g != "" {
				value = g
				break
			}
		}
		value = strings.TrimSpace(value)
		if value == "" || strings.HasPrefix(value, "#") || strings.HasPrefix(value, "data:") {
			continue
		}
		clean := path.Clean(value)
		if strings.HasPrefix(value, "//") || path.IsAbs(value) || clean == ".." || strings.HasPrefix(clean, "../") || schemeRe.MatchString(value) {
			refs = append(refs, value)
		}
	}
	return refs
}

var schemeRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)

var (
	scriptElementRe = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script\s*>`)
	scriptSrcRe     = regexp.MustCompile(`(?i)\bsrc\s*=`)
	inlineHandlerRe = regexp.MustCompile(`(?i)\son(click|change|input|submit|load|error|keydown|keyup|focus|blur|mouseover|mouseout|pointerdown|pointerup)\s*=`)
)

// entryInlineScriptProblems is rule 21's inline-script half. A framed
// page inherits Mill's own document policy, which forbids inline
// script outright (docs/platform/PLUGIN-THREAT-MODEL.md, T9), so an
// inline <script> or an on... attribute is dead code at runtime with
// nothing on screen to say why. The author is told here instead.
func entryInlineScriptProblems(file, html string) []string {
	var problems []string
	for _, match := range scriptElementRe.FindAllStringSubmatch(html, -1) {
		if scriptSrcRe.MatchString(match[1]) || strings.TrimSpace(match[2]) == "" {
			continue
		}
		problems = append(problems, fmt.Sprintf("standard rule 21: %s: an inline <script> never runs in a plugin page; move it to a .js file in your folder", file))
	}
	if inlineHandlerRe.MatchString(html) {
		problems = append(problems, fmt.Sprintf("standard rule 21: %s: an inline event attribute never runs in a plugin page; add the listener from your own script", file))
	}
	return problems
}
