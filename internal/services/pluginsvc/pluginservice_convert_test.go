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
