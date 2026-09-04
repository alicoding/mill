// Package pluginscaffold implements `mill plugin new <name>`, the
// official scaffold for a Mill plugin (goal 0319). It is a subcommand
// of the one binary, never a separate CLI: main.go routes `plugin`
// here and exits with what Run returns.
//
// The scaffold writes what every shipped example has: manifest.json,
// main.js, and a starting icon.png inside the folder -- the asset
// route's own allowlist, nothing else -- plus a README BESIDE the
// folder (the standard's own rule: a plugin folder may hold only
// files the asset route serves, so a README inside it would fail the
// conformance the folder must pass, pluginsvc.ConformDir).
package pluginscaffold

import (
	"bytes"
	"embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
)

//go:embed templates/*.tmpl
var templates embed.FS

// Exit codes, the shell contract this subcommand promises: 0 wrote the
// folder, 1 the invocation was wrong, 2 the target already exists.
const (
	exitOK      = 0
	exitUsage   = 1
	exitExists  = 2
	idMaxLength = 64
)

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

const usage = `Usage: mill plugin new <name> [--dir <path>]

Creates a plugin folder holding manifest.json and main.js.

  <name>        the plugin's name; it becomes the folder and the manifest id
  --dir <path>  where to create the folder (default: the current folder)
`

// Run executes the `plugin` subcommand. args is everything after
// `plugin`; pluginsDir is where Mill scans for installed plugins (the
// path the printed next step names) and millVersion stamps the
// generated manifest's minMillVersion.
func Run(args []string, pluginsDir, millVersion string, out, errOut io.Writer) int {
	if len(args) == 0 || args[0] != "new" {
		_, _ = fmt.Fprint(errOut, usage)
		return exitUsage
	}
	name, dir, problem := parseNewArgs(args[1:])
	if problem != "" {
		_, _ = fmt.Fprintf(errOut, "%s\n\n%s", problem, usage)
		return exitUsage
	}
	id := SlugifyID(name)
	if !idPattern.MatchString(id) {
		_, _ = fmt.Fprintf(errOut, "%q does not make a usable plugin id: use letters, digits, and hyphens\n", name)
		return exitUsage
	}
	target := filepath.Join(dir, id)
	if _, err := os.Stat(target); err == nil {
		_, _ = fmt.Fprintf(errOut, "%s already exists\n", target)
		return exitExists
	}
	if err := write(dir, target, id, TitleLabel(name), millVersion); err != nil {
		_, _ = fmt.Fprintf(errOut, "%v\n", err)
		return exitUsage
	}
	_, _ = fmt.Fprintf(out, "Created %s\n", target)
	_, _ = fmt.Fprintf(out, "Copy this folder into %s and reload plugins in Settings > Extensions.\n", pluginsDir)
	return exitOK
}

// parseNewArgs reads `<name> [--dir <path>]` in either order and
// refuses anything else, so a typo never silently scaffolds somewhere
// unexpected.
func parseNewArgs(args []string) (name, dir, problem string) {
	dir = "."
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--dir":
			rest := args[i+1:]
			if len(rest) == 0 {
				return "", "", "--dir needs a path"
			}
			dir = rest[0]
			i++
		case strings.HasPrefix(args[i], "--dir="):
			dir = strings.TrimPrefix(args[i], "--dir=")
		case strings.HasPrefix(args[i], "-"):
			return "", "", fmt.Sprintf("unknown option %q", args[i])
		case name == "":
			name = args[i]
		default:
			return "", "", "give exactly one name"
		}
	}
	if name == "" {
		return "", "", "give the plugin a name"
	}
	return name, dir, ""
}

// SlugifyID turns a typed name into the id the manifest and the folder
// must share (pluginsvc's own rule: the folder IS the identity).
func SlugifyID(name string) string {
	var b strings.Builder
	prevHyphen := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevHyphen = false
		case !prevHyphen && b.Len() > 0:
			b.WriteRune('-')
			prevHyphen = true
		}
	}
	id := strings.Trim(b.String(), "-")
	if len(id) > idMaxLength {
		id = strings.Trim(id[:idMaxLength], "-")
	}
	return id
}

// TitleLabel is the display name the manifest and the generated code
// carry: the typed name with each word capitalized, hyphens and
// underscores read as spaces.
func TitleLabel(name string) string {
	fields := strings.FieldsFunc(name, func(r rune) bool { return r == ' ' || r == '-' || r == '_' })
	for i, f := range fields {
		fields[i] = strings.ToUpper(f[:1]) + f[1:]
	}
	return strings.Join(fields, " ")
}

type templateData struct {
	ID             string
	Label          string
	MinMillVersion string
}

// write lays down the folder's own two served files plus its
// standard-conformant starting icon, and -- BESIDE the folder, in dir
// -- the README (userdocs/reference/plugin-standard.md rule 14: a
// plugin folder may only hold files the asset route serves, so the
// README can never sit inside it).
func write(dir, target, id, label, millVersion string) error {
	if err := os.MkdirAll(target, 0o750); err != nil {
		return fmt.Errorf("create %s: %w", target, err)
	}
	data := templateData{ID: id, Label: label, MinMillVersion: millVersion}
	for _, file := range []string{"manifest.json", "main.js"} {
		rendered, err := render(file+".tmpl", data)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(target, file), rendered, 0o600); err != nil {
			return fmt.Errorf("write %s: %w", file, err)
		}
	}
	if err := os.WriteFile(filepath.Join(target, "icon.png"), RenderIcon(id), 0o600); err != nil {
		return fmt.Errorf("write icon.png: %w", err)
	}
	readme, err := render("README.md.tmpl", data)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, id+".md"), readme, 0o600); err != nil {
		return fmt.Errorf("write %s.md: %w", id, err)
	}
	return nil
}

func render(name string, data templateData) ([]byte, error) {
	raw, err := templates.ReadFile("templates/" + name)
	if err != nil {
		return nil, fmt.Errorf("read template %s: %w", name, err)
	}
	// text/template, not html/template: the output is JavaScript and
	// JSON source, where HTML escaping would corrupt the very
	// characters (quotes, ampersands) the templates rely on.
	t, err := template.New(name).Parse(string(raw))
	if err != nil {
		return nil, fmt.Errorf("parse template %s: %w", name, err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return nil, fmt.Errorf("render template %s: %w", name, err)
	}
	return buf.Bytes(), nil
}
