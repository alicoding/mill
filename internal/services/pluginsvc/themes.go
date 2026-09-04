package pluginsvc

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Contributed color themes (docs/goals/0342). A theme is DATA, never
// code: a CSS file of nothing but custom-property declarations drawn
// from the documented vocabulary (ThemeVariables, conform_theme.go).
// The host injects it; plugin JavaScript never touches the document,
// so a theme cannot smuggle a selector, an import, or a URL past the
// sandbox.
//
// The manifest half is validated the way every other contribution is
// (a malformed declaration blocks the LOAD, pluginservice_contributes.go);
// the FILE half is a standard rule, so a stylesheet the host would
// refuse fails the author's own check rather than bricking the plugin
// that ships it.

// ThemeContribution declares one color theme: an id unique within the
// plugin, the label the picker lists, which appearance family it
// belongs to, and the CSS file relative to the plugin's own folder.
type ThemeContribution struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Family string `json:"family"`
	File   string `json:"file"`
}

// themeIDPattern is deliberately narrower than pluginIDPattern allows
// for a folder name: a theme id becomes half of the scheme id
// "<pluginId>.<id>", which travels in an attribute value and in
// localStorage, so it may not contain a dot of its own.
var themeIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// ThemeSchemeID is the id a contributed theme is known by everywhere
// outside its own plugin: the appearance store, the picker, and the
// data-mill-scheme attribute. Namespaced by plugin so two plugins may
// both ship a "sepia".
func ThemeSchemeID(pluginID, themeID string) string {
	return pluginID + "." + themeID
}

// validateThemes fail-closes a malformed theme declaration the same
// way an unknown capability does.
func validateThemes(themes []ThemeContribution) string {
	seen := map[string]bool{}
	for _, t := range themes {
		if !themeIDPattern.MatchString(t.ID) {
			return fmt.Sprintf("contributed theme id %q must be lowercase letters, digits, and hyphens", t.ID)
		}
		if strings.TrimSpace(t.Label) == "" {
			return fmt.Sprintf("contributed theme %q needs a label", t.ID)
		}
		if t.Family != "light" && t.Family != "dark" {
			return fmt.Sprintf("contributed theme %q must name family \"light\" or \"dark\"", t.ID)
		}
		if problem := validateThemeFilePath(t); problem != "" {
			return problem
		}
		if seen[t.ID] {
			return fmt.Sprintf("contributed theme %q is declared twice", t.ID)
		}
		seen[t.ID] = true
	}
	return ""
}

// validateThemeFilePath keeps the declared file inside the plugin's
// own folder and on the one extension the asset route serves. The
// route already refuses traversal; refusing it here means the picker
// never offers a theme whose file could not load.
func validateThemeFilePath(t ThemeContribution) string {
	file := t.File
	if file == "" || strings.HasPrefix(file, "/") || strings.Contains(file, "\\") {
		return fmt.Sprintf("contributed theme %q needs a file inside its own folder", t.ID)
	}
	if cleaned := path.Clean(file); cleaned != file || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return fmt.Sprintf("contributed theme %q needs a file inside its own folder", t.ID)
	}
	if strings.ToLower(path.Ext(file)) != ".css" {
		return fmt.Sprintf("contributed theme %q must name a .css file", t.ID)
	}
	return ""
}

// conformThemes reads each declared theme file and reports the first
// line the host would refuse. Standard rule 20.
func conformThemes(dir string, m Manifest) []string {
	var problems []string
	for _, t := range m.Contributes.Themes {
		if problem := validateThemeFilePath(t); problem != "" {
			continue // already a load failure; not restated as a standard rule
		}
		raw, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(t.File))) // #nosec G304 -- File is Clean, relative and extension-checked above, under the caller's own plugin folder
		if err != nil {
			problems = append(problems, fmt.Sprintf("standard rule 20: theme %q names %q, which is missing or unreadable", t.ID, t.File))
			continue
		}
		if line, problem := ValidateThemeCSS(string(raw)); problem != "" {
			problems = append(problems, fmt.Sprintf("standard rule 20: theme %q, %s line %d: %s", t.ID, t.File, line, problem))
		}
	}
	sort.Strings(problems)
	return problems
}

var (
	themeDeclRe   = regexp.MustCompile(`^(--[A-Za-z0-9_-]+)\s*:\s*(\S.*)$`)
	themeBannedRe = regexp.MustCompile(`(?i)\b(url|expression|image-set)\s*\(`)
)

// ValidateThemeCSS is the host's theme-file parser, shared by the
// author's conformance check and the runtime injector's own copy
// (frontend/src/shared/appearanceThemes.ts holds the identical rules).
// A theme file is a FLAT sequence of custom-property declarations and
// nothing else: no selector, no at-rule, no url(). It returns the
// 1-based line of the first refusal and a reason, or (0, "") when the
// whole file is acceptable.
func ValidateThemeCSS(src string) (int, string) {
	stripped, ok, line := stripThemeComments(src)
	if !ok {
		return line, "a comment is never closed"
	}
	lineOf := 1
	start := 1
	var segment strings.Builder
	flush := func() (int, string) {
		text := strings.TrimSpace(segment.String())
		segment.Reset()
		if text == "" {
			return 0, ""
		}
		return start, themeDeclarationProblem(text)
	}
	for _, r := range stripped {
		switch r {
		case '\n':
			lineOf++
			segment.WriteRune(' ')
		case '{', '}':
			return lineOf, "a theme file holds declarations only, never a selector or a block"
		case '@':
			return lineOf, "a theme file holds declarations only, never an at-rule"
		case ';':
			if at, problem := flush(); problem != "" {
				return at, problem
			}
			start = lineOf
		default:
			if strings.TrimSpace(segment.String()) == "" && r != ' ' && r != '\t' {
				start = lineOf
			}
			segment.WriteRune(r)
		}
	}
	if at, problem := flush(); problem != "" {
		return at, problem
	}
	return 0, ""
}

// themeDeclarationProblem judges one semicolon-separated statement.
func themeDeclarationProblem(text string) string {
	m := themeDeclRe.FindStringSubmatch(text)
	if m == nil {
		return "only \"--token: value\" declarations belong here"
	}
	if !ThemeVariables[m[1]] {
		return fmt.Sprintf("%s is not a documented theme variable", m[1])
	}
	if themeBannedRe.MatchString(m[2]) {
		return "a theme value may not load anything from outside the file"
	}
	return ""
}

// stripThemeComments blanks /* */ comments while preserving newlines,
// so a refusal further down still reports the author's own line number.
func stripThemeComments(src string) (string, bool, int) {
	var out strings.Builder
	line, openedAt, inComment := 1, 0, false
	for i := 0; i < len(src); i++ {
		if src[i] == '\n' {
			line++
			out.WriteByte('\n')
			continue
		}
		if inComment {
			if src[i] == '*' && i+1 < len(src) && src[i+1] == '/' {
				inComment = false
				i++
			}
			continue
		}
		if src[i] == '/' && i+1 < len(src) && src[i+1] == '*' {
			inComment, openedAt = true, line
			i++
			continue
		}
		out.WriteByte(src[i])
	}
	if inComment {
		return "", false, openedAt
	}
	return out.String(), true, 0
}
