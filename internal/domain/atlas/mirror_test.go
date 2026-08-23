package atlas

import "testing"

func TestClassifyMirrorKind(t *testing.T) {
	cases := []struct {
		path string
		want MirrorKind
	}{
		{"notes.md", MirrorKindMarkdown},
		{"NOTES.MARKDOWN", MirrorKindMarkdown},
		{"photo.png", MirrorKindImage},
		{"photo.JPG", MirrorKindImage},
		{"diagram.svg", MirrorKindImage},
		{"log.txt", MirrorKindText},
		{"data.json", MirrorKindText},
		{"diagram.mmd", MirrorKindText},
		{"diagram.MERMAID", MirrorKindText},
		{"archive.zip", MirrorKindOther},
		{"no-extension", MirrorKindOther},
		{"", MirrorKindOther},
	}
	for _, c := range cases {
		if got := ClassifyMirrorKind(c.path); got != c.want {
			t.Errorf("ClassifyMirrorKind(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}

func TestMirrorImageMimeType(t *testing.T) {
	if got := MirrorImageMimeType("photo.png"); got != "image/png" {
		t.Errorf("MirrorImageMimeType(photo.png) = %q, want image/png", got)
	}
	if got := MirrorImageMimeType("notes.md"); got != "" {
		t.Errorf("MirrorImageMimeType(notes.md) = %q, want empty (not an image)", got)
	}
}
