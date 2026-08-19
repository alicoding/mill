package compositionsvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/servicetest"
)

// PreviewHTMLToMarkdown must produce exactly what a real
// process-html-to-markdown node run would (goal 0115 slice 1) -- both
// call the same markdown.ToMarkdown converter.
func TestPreviewHTMLToMarkdown(t *testing.T) {
	tests := []struct {
		name     string
		html     string
		wantErr  bool
		contains []string
	}{
		{
			name:     "heading and list",
			html:     "<h1>Hi</h1><ul><li>a</li></ul>",
			contains: []string{"# Hi", "- a"},
		},
		{
			name: "empty input returns empty without error",
			html: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := NewCompositionService(servicetest.NewFakeStore())
			got, err := c.PreviewHTMLToMarkdown(tt.html)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("PreviewHTMLToMarkdown(%q): want error, got nil", tt.html)
				}
				return
			}
			if err != nil {
				t.Fatalf("PreviewHTMLToMarkdown(%q): unexpected error: %v", tt.html, err)
			}
			if tt.html == "" && got != "" {
				t.Fatalf("PreviewHTMLToMarkdown(\"\"): want empty output, got %q", got)
			}
			for _, want := range tt.contains {
				if !strings.Contains(got, want) {
					t.Errorf("PreviewHTMLToMarkdown(%q) = %q, want it to contain %q", tt.html, got, want)
				}
			}
		})
	}
}
