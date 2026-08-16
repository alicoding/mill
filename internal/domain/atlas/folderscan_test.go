package atlas

import "testing"

func TestClassifyScanExtension(t *testing.T) {
	cases := []struct {
		ext  string
		want ScanCategory
	}{
		{".png", ScanCategoryImage},
		{".PNG", ScanCategoryImage},
		{".jpg", ScanCategoryImage},
		{".svg", ScanCategoryImage},
		{".md", ScanCategoryFile},
		{".txt", ScanCategoryFile},
		{".pdf", ScanCategoryFile},
		{".docx", ScanCategoryFile},
		{".zzz-unknown", ScanCategoryFile},
		{"", ScanCategoryFile},
	}
	for _, c := range cases {
		if got := ClassifyScanExtension(c.ext); got != c.want {
			t.Errorf("ClassifyScanExtension(%q) = %q, want %q", c.ext, got, c.want)
		}
	}
}

func TestHumanizeFilename(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"meeting_notes.md", "Meeting Notes"},
		{"project-plan-v2.txt", "Project Plan V2"},
		{"already Nice.pdf", "Already Nice"},
		{"logo.png", "Logo"},
		{"noextension", "Noextension"},
	}
	for _, c := range cases {
		if got := HumanizeFilename(c.name); got != c.want {
			t.Errorf("HumanizeFilename(%q) = %q, want %q", c.name, got, c.want)
		}
	}
}
