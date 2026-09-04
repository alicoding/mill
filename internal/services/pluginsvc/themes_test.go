package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateThemes_AcceptsAWellFormedDeclaration(t *testing.T) {
	if problem := validateThemes([]ThemeContribution{{ID: "sepia", Label: "Sepia", Family: "light", File: "themes/sepia.css"}}); problem != "" {
		t.Fatalf("expected no problem, got %q", problem)
	}
}

func TestValidateThemes_RefusesMalformedDeclarations(t *testing.T) {
	cases := map[string]ThemeContribution{
		"empty id":      {ID: "", Label: "Sepia", Family: "light", File: "a.css"},
		"dotted id":     {ID: "warm.sepia", Label: "Sepia", Family: "light", File: "a.css"},
		"no label":      {ID: "sepia", Label: "  ", Family: "light", File: "a.css"},
		"other family":  {ID: "sepia", Label: "Sepia", Family: "sepia", File: "a.css"},
		"absolute file": {ID: "sepia", Label: "Sepia", Family: "light", File: "/etc/a.css"},
		"traversal":     {ID: "sepia", Label: "Sepia", Family: "light", File: "../a.css"},
		"unclean path":  {ID: "sepia", Label: "Sepia", Family: "light", File: "themes/./a.css"},
		"not css":       {ID: "sepia", Label: "Sepia", Family: "light", File: "themes/a.js"},
	}
	for name, c := range cases {
		if problem := validateThemes([]ThemeContribution{c}); problem == "" {
			t.Errorf("%s: expected a problem, got none", name)
		}
	}
}

func TestValidateThemes_RefusesADuplicateID(t *testing.T) {
	themes := []ThemeContribution{
		{ID: "sepia", Label: "Sepia", Family: "light", File: "a.css"},
		{ID: "sepia", Label: "Sepia again", Family: "light", File: "b.css"},
	}
	if problem := validateThemes(themes); !strings.Contains(problem, "declared twice") {
		t.Fatalf("expected a duplicate problem, got %q", problem)
	}
}

func TestValidateThemeCSS_AcceptsDocumentedDeclarations(t *testing.T) {
	src := "/* Sepia */\n--bgColor-default: #f4ecd8;\n--fgColor-default: #3b3128;\n--mill-accent-fg: #7a5c2e;\n"
	if line, problem := ValidateThemeCSS(src); problem != "" {
		t.Fatalf("line %d: %s", line, problem)
	}
}

func TestValidateThemeCSS_AcceptsATrailingDeclarationWithoutASemicolon(t *testing.T) {
	if line, problem := ValidateThemeCSS("--bgColor-default: #fff"); problem != "" {
		t.Fatalf("line %d: %s", line, problem)
	}
}

func TestValidateThemeCSS_NamesTheRefusedLine(t *testing.T) {
	cases := []struct {
		name string
		src  string
		line int
	}{
		{"a selector", "--bgColor-default: #fff;\n\n:root {\n--fgColor-default: #000;\n}\n", 3},
		{"an at-rule", "--bgColor-default: #fff;\n@import url(evil.css);\n", 2},
		{"a url value", "--bgColor-default: #fff;\n--bgColor-muted: url(http://evil/x.png);\n", 2},
		{"an undocumented token", "--bgColor-default: #fff;\n--not-a-token: red;\n", 2},
		{"a bare value", "--bgColor-default: #fff;\ncolor: red;\n", 2},
		{"an unclosed comment", "--bgColor-default: #fff;\n/* forever\n--fgColor-default: #000;\n", 2},
	}
	for _, c := range cases {
		line, problem := ValidateThemeCSS(c.src)
		if problem == "" {
			t.Errorf("%s: expected a refusal", c.name)
			continue
		}
		if line != c.line {
			t.Errorf("%s: expected line %d, got %d (%s)", c.name, c.line, line, problem)
		}
	}
}

func TestThemeSchemeID_NamespacesByPlugin(t *testing.T) {
	if got := ThemeSchemeID("mill-scribble", "sepia"); got != "mill-scribble.sepia" {
		t.Fatalf("got %q", got)
	}
}

func TestConformThemes_ReportsTheFileAndLine(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "themes"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "themes", "bad.css"), []byte("--bgColor-default: #fff;\n:root { --fgColor-default: #000; }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	m := Manifest{Contributes: ManifestContributes{Themes: []ThemeContribution{
		{ID: "bad", Label: "Bad", Family: "light", File: "themes/bad.css"},
		{ID: "missing", Label: "Missing", Family: "dark", File: "themes/gone.css"},
	}}}
	problems := conformThemes(dir, m)
	if len(problems) != 2 {
		t.Fatalf("expected two problems, got %v", problems)
	}
	joined := strings.Join(problems, "\n")
	if !strings.Contains(joined, "themes/bad.css line 2") {
		t.Errorf("expected the refused line, got %v", problems)
	}
	if !strings.Contains(joined, "missing or unreadable") {
		t.Errorf("expected the missing-file problem, got %v", problems)
	}
}
