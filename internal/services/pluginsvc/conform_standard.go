package pluginsvc

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/mod/semver"
)

// The plugin standard's machine-checkable half
// (userdocs/reference/plugin-standard.md, goal 0322): rules ConformDir
// enforces beyond the loader's own manifestProblem -- identity, the
// icon, no remote code, and copy shape. Each problem or warning names
// its rule number so an author can find it on the standard page.

const iconSize = 128

// conformStandard runs every standard rule that fails the build.
func conformStandard(dir string, m Manifest) []string {
	scripts := jsSources(dir)
	problems := make([]string, 0, 8)
	problems = append(problems, conformIdentity(m)...)
	problems = append(problems, conformVersion(m)...)
	problems = append(problems, conformSettingDescriptions(m)...)
	problems = append(problems, conformIcon(dir, m)...)
	problems = append(problems, conformCommandNamespace(m)...)
	problems = append(problems, conformRemoteCode(scripts)...)
	problems = append(problems, conformLabelCase(m, scripts)...)
	problems = append(problems, conformThemes(dir, m)...)
	problems = append(problems, conformEntryPages(dir, m)...)
	sort.Strings(problems)
	return problems
}

// conformVersion is standard rule 12: version must parse as semver.
// The loader only requires it non-empty (manifestProblem), so an
// author sees this as a standard failure, never a load refusal.
func conformVersion(m Manifest) []string {
	if semver.IsValid("v" + strings.TrimPrefix(m.Version, "v")) {
		return nil
	}
	return []string{fmt.Sprintf("standard rule 12: version %q must be a version like \"1.2.0\"", m.Version)}
}

// conformSettingDescriptions is standard rule 1's description half
// (type and default are already load-blocking checks in
// validateSettingContribution).
func conformSettingDescriptions(m Manifest) []string {
	var problems []string
	for _, s := range m.Contributes.Settings {
		if strings.TrimSpace(s.Description) == "" {
			problems = append(problems, fmt.Sprintf("standard rule 1: contributed setting %q needs a description", s.Key))
		}
	}
	return problems
}

// conformCommandNamespace is standard rule 17's command-id half: every
// declared command id is "<plugin id>.<verb>". The loader
// (validateCommands) is more permissive, so an existing plugin using
// the older bare-slug shape still loads -- this is what actually holds
// a plugin to the standard's namespaced shape.
func conformCommandNamespace(m Manifest) []string {
	var problems []string
	for _, c := range m.Contributes.Commands {
		if !namespacedCommandID(m.ID, c.ID) {
			problems = append(problems, fmt.Sprintf("standard rule 17: command id %q must be %q followed by a verb, e.g. %q", c.ID, m.ID+".", m.ID+".doThing"))
		}
	}
	return problems
}

// ConformStandardWarnings returns the standard's advisory findings for
// a folder (rules 3 and 9): a warning is the author's call, not a
// failure, so only the command-line checker surfaces it.
func ConformStandardWarnings(dir string) []string {
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json")) // #nosec G304 -- the caller's own plugin folder
	if err != nil {
		return nil
	}
	m, parseProblem := parseManifest(raw)
	if parseProblem != "" {
		return nil
	}
	scripts := jsSources(dir)
	warnings := make([]string, 0, 4)
	warnings = append(warnings, conformUnusedCapabilities(m, scripts)...)
	warnings = append(warnings, conformConsoleErrorWithoutNotify(scripts)...)
	warnings = append(warnings, conformSurfacesWithoutEntry(m)...)
	sort.Strings(warnings)
	return warnings
}

// jsSources reads every .js file the folder ships (vendor/ and hidden/
// dependency directories excluded, the same exemption conform_theme.go
// applies -- vendored code is not this plugin's own copy or logic),
// keyed by its path relative to dir.
func jsSources(dir string) map[string]string {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil
	}
	out := map[string]string{}
	for _, rel := range themeSourceFiles(root) {
		if filepath.Ext(rel) != ".js" {
			continue
		}
		raw, readErr := os.ReadFile(filepath.Join(root, rel)) // #nosec G304 -- rel came from this same folder's own walk
		if readErr != nil {
			continue
		}
		out[rel] = string(raw)
	}
	return out
}

// conformIdentity is standard rule 11's name half (the id's own shape
// and its match against the folder are already load-blocking checks
// in manifestProblem): the manifest already carries "Mill" as its
// vendor and "plugin" as the platform noun, so a name repeating
// either is noise a user reads on every row.
func conformIdentity(m Manifest) []string {
	var problems []string
	lower := strings.ToLower(m.Name)
	if strings.Contains(lower, "mill") {
		problems = append(problems, fmt.Sprintf("standard rule 11: name %q must not contain \"Mill\"", m.Name))
	}
	if strings.Contains(lower, "plugin") {
		problems = append(problems, fmt.Sprintf("standard rule 11: name %q must not contain \"plugin\"", m.Name))
	}
	return problems
}

// conformIcon is standard rule 13: a declared 128x128 icon.png, and --
// only when the file exists -- a matching-size icon@dark.png.
func conformIcon(dir string, m Manifest) []string {
	if strings.TrimSpace(m.Icon) == "" {
		return []string{"standard rule 13: manifest needs an \"icon\" naming a 128x128 icon.png"}
	}
	var problems []string
	if p := pngSizeProblem(dir, m.Icon, "icon"); p != "" {
		problems = append(problems, p)
	}
	dark := darkIconName(m.Icon)
	if _, err := os.Stat(filepath.Join(dir, dark)); err == nil {
		if p := pngSizeProblem(dir, dark, "icon@dark"); p != "" {
			problems = append(problems, p)
		}
	}
	return problems
}

func darkIconName(icon string) string {
	ext := filepath.Ext(icon)
	return strings.TrimSuffix(icon, ext) + "@dark" + ext
}

func pngSizeProblem(dir, rel, label string) string {
	if strings.ToLower(filepath.Ext(rel)) != ".png" {
		return fmt.Sprintf("standard rule 13: %s %q must be a .png file", label, rel)
	}
	w, h, err := pngDimensions(filepath.Join(dir, rel))
	if err != nil {
		return fmt.Sprintf("standard rule 13: %s %q is missing or unreadable", label, rel)
	}
	if w != iconSize || h != iconSize {
		return fmt.Sprintf("standard rule 13: %s %q is %dx%d, must be %dx%d", label, rel, w, h, iconSize, iconSize)
	}
	return ""
}

var pngSignature = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

// pngDimensions decodes only a PNG's IHDR header -- the first 24
// bytes -- rather than the whole image; conformance only needs the
// pixel size.
func pngDimensions(path string) (int, int, error) {
	f, err := os.Open(path) // #nosec G304 -- the caller's own plugin folder
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = f.Close() }()
	head := make([]byte, 24)
	if _, err := io.ReadFull(f, head); err != nil {
		return 0, 0, err
	}
	if !bytes.Equal(head[:8], pngSignature) {
		return 0, 0, fmt.Errorf("not a PNG file")
	}
	w := binary.BigEndian.Uint32(head[16:20])
	h := binary.BigEndian.Uint32(head[20:24])
	return int(w), int(h), nil
}

// identCharRe marks a character that continues an identifier, so a
// bare-call scan does not mistake the tail of a longer name (myFetch,
// safeEval) for the token it is checking.
var identCharRe = regexp.MustCompile(`[A-Za-z0-9_$]`)

var (
	fetchTokenRe   = regexp.MustCompile(`fetch\s*\(`)
	evalTokenRe    = regexp.MustCompile(`eval\s*\(`)
	dynImportURLRe = regexp.MustCompile(`import\s*\(\s*['"` + "`" + `]https?:`)
)

// conformRemoteCode is standard rule 15: no fetch outside api.fetch, no
// eval, no import() of a URL -- the three doors that would let a
// plugin run code Mill never mediated.
func conformRemoteCode(scripts map[string]string) []string {
	var problems []string
	for rel, src := range scripts {
		if n := countBareCalls(src, fetchTokenRe, "api."); n > 0 {
			problems = append(problems, fmt.Sprintf("standard rule 15: %s: %d fetch(...) call(s) not made through api.fetch", rel, n))
		}
		if n := countBareCalls(src, evalTokenRe, ""); n > 0 {
			problems = append(problems, fmt.Sprintf("standard rule 15: %s: %d eval(...) call(s) -- eval is not allowed", rel, n))
		}
		if dynImportURLRe.MatchString(src) {
			problems = append(problems, fmt.Sprintf("standard rule 15: %s: import() of a URL is not allowed", rel))
		}
	}
	return problems
}

// countBareCalls counts tokenRe's whole-token matches in src that are
// not immediately preceded by requiredPrefix (e.g. "fetch(" reached
// directly rather than through "api.fetch("); an empty requiredPrefix
// counts every whole-token match.
func countBareCalls(src string, tokenRe *regexp.Regexp, requiredPrefix string) int {
	count := 0
	for _, loc := range tokenRe.FindAllStringIndex(src, -1) {
		start := loc[0]
		if start > 0 && identCharRe.MatchString(string(src[start-1])) {
			continue // the tail of a longer identifier, not this token
		}
		if requiredPrefix != "" && strings.HasSuffix(src[:start], requiredPrefix) {
			continue
		}
		count++
	}
	return count
}

// jsLabelRe finds every object-literal `label: '...'` a plugin's own
// script writes -- registerCommand, registerCanvasObject, registerView
// and object menuItems all shape their label this way. RE2 has no
// backreference, so the three quote styles are three alternatives
// rather than one capture reused as a closing delimiter.
var jsLabelRe = regexp.MustCompile(`label:\s*(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|` + "`" + `([^` + "`" + `\\]*(?:\\.[^` + "`" + `\\]*)*)` + "`" + `)`)

// jsLabelValue picks whichever of jsLabelRe's three quote-style groups
// matched.
func jsLabelValue(match []string) string {
	for _, g := range match[1:] {
		if g != "" {
			return g
		}
	}
	return ""
}

// conformLabelCase is standard rule 16: every label/title/name a user
// reads -- the manifest's own and every one a script registers -- is
// sentence case with no emoji (an object's `icon` field is a glyph by
// design and is not a label).
func conformLabelCase(m Manifest, scripts map[string]string) []string {
	var problems []string
	check := func(context, s string) {
		if p := labelProblem(context, s); p != "" {
			problems = append(problems, p)
		}
	}
	check("name", m.Name)
	for _, s := range m.Contributes.Settings {
		check(fmt.Sprintf("setting %q label", s.Key), s.Label)
		for _, o := range s.Options {
			check(fmt.Sprintf("setting %q option %q label", s.Key, o.Value), o.Label)
		}
	}
	for _, c := range m.Contributes.Commands {
		check(fmt.Sprintf("command %q label", c.ID), c.Label)
	}
	for _, v := range m.Contributes.Views {
		check(fmt.Sprintf("view %q title", v.ID), v.Title)
	}
	for _, st := range m.Contributes.Steps {
		check(fmt.Sprintf("step %q label", st.ID), st.Label)
		for _, cf := range st.Config {
			check(fmt.Sprintf("step %q config %q label", st.ID, cf.Key), cf.Label)
		}
	}
	for _, cp := range m.Contributes.Captures {
		check(fmt.Sprintf("capture %q label", cp.ID), cp.Label)
	}
	for _, src := range m.Contributes.SecretSources {
		check(fmt.Sprintf("secret source %q label", src.ID), src.Label)
		check(fmt.Sprintf("secret source %q path label", src.ID), src.Path.Label)
	}
	for rel, src := range scripts {
		for _, match := range jsLabelRe.FindAllStringSubmatch(src, -1) {
			check(rel+": a registered label", jsLabelValue(match))
		}
	}
	return problems
}

func labelProblem(context, s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	if !startsUppercase(s) {
		return fmt.Sprintf("standard rule 16: %s %q must start with a capital letter (sentence case)", context, s)
	}
	if containsEmoji(s) {
		return fmt.Sprintf("standard rule 16: %s %q must not contain an emoji", context, s)
	}
	return ""
}

func startsUppercase(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return unicode.IsUpper(r)
		}
	}
	return true // no letters (a number, punctuation) -- nothing to check
}

// emojiRanges approximates Unicode's Extended_Pictographic property --
// not one of the categories Go's regexp package exposes -- with the
// blocks the common emoji actually live in.
var emojiRanges = []*unicode.RangeTable{
	{R16: []unicode.Range16{
		{Lo: 0x2600, Hi: 0x27BF, Stride: 1},
		{Lo: 0x2B00, Hi: 0x2BFF, Stride: 1},
		{Lo: 0xFE0F, Hi: 0xFE0F, Stride: 1},
	}},
	{R32: []unicode.Range32{
		{Lo: 0x1F300, Hi: 0x1FAFF, Stride: 1},
	}},
}

func containsEmoji(s string) bool {
	for _, r := range s {
		for _, rt := range emojiRanges {
			if unicode.Is(rt, r) {
				return true
			}
		}
	}
	return false
}

// capabilityUsageMarkers names, for each known capability, the source
// substring its real use always contains -- the guarded-action kind
// string for a requestGuardedAction capability, the specific API door
// for the rest. A capability missing from this map is skipped (an
// unknown capability is the loader's own error, not this warning).
var capabilityUsageMarkers = map[string][]string{
	"open-url":          {"requestGuardedAction('open-url'", `requestGuardedAction("open-url"`},
	"open-app":          {"requestGuardedAction('open-app'", `requestGuardedAction("open-app"`},
	"list-files":        {"api.files.list("},
	"erase-board-items": {"eraseHitTest(", "commitErase("},
	"fetch":             {"api.fetch("},
	"write-content":     {"api.content."},
	"read-file":         {"ctx.readFile(", "ctx.listFiles("},
}

// conformUnusedCapabilities is standard rule 3: a capability the
// manifest asks for but the code never reaches is a warning, not a
// failure -- the author may be about to use it.
func conformUnusedCapabilities(m Manifest, scripts map[string]string) []string {
	var joined strings.Builder
	for _, src := range scripts {
		joined.WriteString(src)
		joined.WriteByte('\n')
	}
	all := joined.String()
	var problems []string
	for _, capability := range m.Capabilities {
		markers := capabilityUsageMarkers[capability]
		if len(markers) == 0 {
			continue
		}
		used := false
		for _, marker := range markers {
			if strings.Contains(all, marker) {
				used = true
				break
			}
		}
		if !used {
			problems = append(problems, fmt.Sprintf("standard rule 3: declared capability %q is never used in this plugin's code", capability))
		}
	}
	return problems
}

// consoleErrorRe matches console.error whether it is CALLED directly
// (console.error("...")) or passed as a bare callback reference
// (.catch(console.error)) -- both report a failure to the console
// alone.
var consoleErrorRe = regexp.MustCompile(`console\.error\b`)

// conformConsoleErrorWithoutNotify is standard rule 9: a failure a
// user never sees is not reported. A console.error with no api.notify
// anywhere in its own enclosing function is a warning.
func conformConsoleErrorWithoutNotify(scripts map[string]string) []string {
	var problems []string
	for rel, src := range scripts {
		for _, loc := range consoleErrorRe.FindAllStringIndex(src, -1) {
			if enclosingFunctionHasNotify(src, loc[0]) {
				continue
			}
			problems = append(problems, fmt.Sprintf("standard rule 9: %s: console.error with no api.notify in the same function", rel))
		}
	}
	return problems
}

// enclosingFunctionHasNotify approximates rule 9's "same function"
// scope with a brace-depth scan: walk backward from pos to the
// nearest unmatched "{", forward to its matching "}", and look for
// api.notify anywhere in that span. It does not parse strings or
// comments, so a brace inside either can widen the span it checks --
// a false negative (missing a real violation), never a false failure.
func enclosingFunctionHasNotify(src string, pos int) bool {
	start := enclosingBraceStart(src, pos)
	end := matchingBraceEnd(src, start)
	span := src[start:end]
	// Two spellings of the same door: a plugin's own code holds the api
	// object, while an entry page reaches it by name over the frame's
	// bridge.
	return strings.Contains(span, "api.notify(") || strings.Contains(span, "call('notify'") || strings.Contains(span, `call("notify"`)
}

func enclosingBraceStart(src string, pos int) int {
	depth := 0
	for i := pos - 1; i >= 0; i-- {
		switch src[i] {
		case '}':
			depth++
		case '{':
			if depth == 0 {
				return i
			}
			depth--
		}
	}
	return 0
}

func matchingBraceEnd(src string, start int) int {
	if start >= len(src) || src[start] != '{' {
		return len(src)
	}
	depth := 0
	for i := start; i < len(src); i++ {
		switch src[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i + 1
			}
		}
	}
	return len(src)
}
