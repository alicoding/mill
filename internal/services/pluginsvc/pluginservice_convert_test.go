package pluginsvc

import (
	"strings"
	"testing"
)

func TestConvertHTMLToMarkdown_IsTheSharedConverter(t *testing.T) {
	p := &PluginService{}
	out, err := p.ConvertHTMLToMarkdown("<h1>Title</h1><p>Body with <strong>bold</strong>.</p>")
	if err != nil {
		t.Fatalf("ConvertHTMLToMarkdown: %v", err)
	}
	if !strings.Contains(out, "# Title") || !strings.Contains(out, "**bold**") {
		t.Errorf("unexpected markdown: %q", out)
	}
}

func TestConvertMarkdownToHTML_IsTheSharedRenderer(t *testing.T) {
	p := &PluginService{}
	out, err := p.ConvertMarkdownToHTML("# Title\n\nBody with **bold**.")
	if err != nil {
		t.Fatalf("ConvertMarkdownToHTML: %v", err)
	}
	if !strings.Contains(out, "<h1>Title</h1>") || !strings.Contains(out, "<strong>bold</strong>") {
		t.Errorf("unexpected html: %q", out)
	}
}
