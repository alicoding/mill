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
		{"report.pdf", MirrorKindPdf},
		{"REPORT.PDF", MirrorKindPdf},
		{"data.json", MirrorKindText},
		{"diagram.mmd", MirrorKindText},
		{"diagram.MERMAID", MirrorKindText},
		{"chart.drawio", MirrorKindText},
		{"chart.DRAWIO", MirrorKindText},
		{"chart.drawio.svg", MirrorKindImage},
		{"data.csv", MirrorKindText},
		{"book.xlsx", MirrorKindSheet},
		{"book.XLSX", MirrorKindSheet},
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

func TestMirrorSheetMimeType(t *testing.T) {
	if got := MirrorSheetMimeType("book.xlsx"); got != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Errorf("MirrorSheetMimeType(book.xlsx) = %q, want the xlsx MIME type", got)
	}
	if got := MirrorSheetMimeType("notes.md"); got != "" {
		t.Errorf("MirrorSheetMimeType(notes.md) = %q, want empty (not a spreadsheet)", got)
	}
}

func TestIsDiagramMirrorExtension_CoversSpreadsheetExtensions(t *testing.T) {
	cases := []struct {
		ext  string
		want bool
	}{
		{".xlsx", true},
		{".XLSX", true},
		{".csv", true},
		{".drawio", true},
		{".json", true},
		{".yaml", true},
		{".yml", true},
		{".YAML", true},
		{".md", false},
		{".txt", false},
	}
	for _, c := range cases {
		if got := IsDiagramMirrorExtension(c.ext); got != c.want {
			t.Errorf("IsDiagramMirrorExtension(%q) = %v, want %v", c.ext, got, c.want)
		}
	}
}

func TestIsImageExtension(t *testing.T) {
	cases := []struct {
		ext  string
		want bool
	}{
		{".png", true},
		{".JPG", true},
		{".svg", true},
		{".md", false},
		{".zip", false},
		{"", false},
	}
	for _, c := range cases {
		if got := IsImageExtension(c.ext); got != c.want {
			t.Errorf("IsImageExtension(%q) = %v, want %v", c.ext, got, c.want)
		}
	}
}
