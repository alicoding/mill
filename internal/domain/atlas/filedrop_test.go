package atlas

import "testing"

func TestClassifyDropExtension(t *testing.T) {
	cases := []struct {
		ext  string
		want DropCategory
	}{
		{".md", DropCategoryProse},
		{".MD", DropCategoryProse},
		{".markdown", DropCategoryProse},
		{".txt", DropCategoryProse},
		{".docx", DropCategoryProse},
		{".pdf", DropCategoryProse},
		{".doc", DropCategoryProse},
		{".rtf", DropCategoryProse},
		{".odt", DropCategoryProse},
		{".pages", DropCategoryProse},
		{".png", DropCategoryOther},
		{".zip", DropCategoryOther},
		{".exe", DropCategoryOther},
		{"", DropCategoryOther},
		{".", DropCategoryOther},
	}
	for _, c := range cases {
		if got := ClassifyDropExtension(c.ext); got != c.want {
			t.Errorf("ClassifyDropExtension(%q) = %q, want %q", c.ext, got, c.want)
		}
	}
}

func TestClassifyDropPath(t *testing.T) {
	cases := []struct {
		path string
		want DropCategory
	}{
		{"/Users/me/notes/meeting.md", DropCategoryProse},
		{"/Users/me/Downloads/photo.PNG", DropCategoryOther},
		{"/Users/me/Downloads/archive.tar.gz", DropCategoryOther},
		{"no-extension", DropCategoryOther},
	}
	for _, c := range cases {
		if got := ClassifyDropPath(c.path); got != c.want {
			t.Errorf("ClassifyDropPath(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}
