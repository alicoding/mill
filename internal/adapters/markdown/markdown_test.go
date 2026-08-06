package markdown

import (
	"strings"
	"testing"
)

func TestToMarkdown(t *testing.T) {
	tests := []struct {
		name string
		html string
		want string
	}{
		{
			name: "heading",
			html: "<h2>Quarterly update</h2>",
			want: "## Quarterly update",
		},
		{
			name: "bold",
			html: "<p>the <strong>important</strong> bit</p>",
			want: "the **important** bit",
		},
		{
			name: "list",
			html: "<ul><li>one</li><li>two</li></ul>",
			want: "- one\n- two",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ToMarkdown(tt.html)
			if err != nil {
				t.Fatalf("ToMarkdown(%q) returned error: %v", tt.html, err)
			}
			if !strings.Contains(got, tt.want) {
				t.Errorf("ToMarkdown(%q) = %q, want it to contain %q", tt.html, got, tt.want)
			}
		})
	}
}

func TestToMarkdown_PlainTextPassesThrough(t *testing.T) {
	got, err := ToMarkdown("just plain text, no tags")
	if err != nil {
		t.Fatalf("ToMarkdown returned error: %v", err)
	}
	if !strings.Contains(got, "just plain text, no tags") {
		t.Errorf("ToMarkdown(plain text) = %q, want the text preserved", got)
	}
}
