package drawio

import (
	"strings"
	"testing"
)

const incomingFragment = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="2" value="Imported" vertex="1" parent="1"><mxGeometry x="9" y="9" width="20" height="20" as="geometry"/></mxCell>` +
	`<mxCell id="new" value="Fresh" vertex="1" parent="1"><mxGeometry x="1" y="1" width="2" height="2" as="geometry"/></mxCell>` +
	`<mxCell id="link" edge="1" parent="1" source="2" target="new"/></root></mxGraphModel>`

func TestImportInto_AddRemintsCollidingIDsAndKeepsBothSides(t *testing.T) {
	_, p := samplePageDoc(t)
	d, _ := ParseDocument(samplePage)
	res, err := ImportInto(d, "", incomingFragment, ImportAdd, "")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if res.Added != 3 {
		t.Fatalf("added = %d, want 3", res.Added)
	}
	remapped := res.Remapped["2"]
	if remapped == "" || !strings.HasPrefix(remapped, "mill-") {
		t.Fatalf("remapped = %v, want the colliding id 2 re-minted", res.Remapped)
	}
	target, _ := d.Page("")
	_, cells, err := ReadPage(target)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(cells) != 6 {
		t.Fatalf("cells = %d, want the page's own 3 plus 3 imported", len(cells))
	}
	byID := map[string]CellOut{}
	for _, c := range cells {
		byID[c.ID] = c
	}
	if byID["2"].Label != "Start" {
		t.Errorf("the page's own cell 2 was overwritten: %+v", byID["2"])
	}
	if byID[remapped].Label != "Imported" {
		t.Errorf("the imported cell did not land under its new id: %+v", byID[remapped])
	}
	// The imported edge follows the re-mint.
	if byID["link"].Source != remapped || byID["link"].Target != "new" {
		t.Errorf("imported edge endpoints = %+v", byID["link"])
	}
	_ = p
}

func TestImportInto_NewPageAppendsAndLeavesTheOriginalAlone(t *testing.T) {
	d, _ := ParseDocument(samplePage)
	res, err := ImportInto(d, "", incomingFragment, ImportNewPage, "Second thoughts")
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if len(res.Pages) != 1 || res.Pages[0].Name != "Second thoughts" {
		t.Fatalf("pages = %+v", res.Pages)
	}
	if len(d.Pages()) != 2 {
		t.Fatalf("pages = %d, want 2", len(d.Pages()))
	}
	out, err := d.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(out, `<mxCell id="2" value="Start"`) {
		t.Errorf("the original page changed: %s", out)
	}
	if !strings.Contains(out, `name="Second thoughts"`) || !strings.Contains(out, `value="Imported"`) {
		t.Errorf("the new page did not land: %s", out)
	}
}

func TestNormalizeSource_AcceptsEveryWireForm(t *testing.T) {
	compressed, err := deflateWireText(incomingFragment)
	if err != nil {
		t.Fatalf("deflate: %v", err)
	}
	for name, in := range map[string]string{
		"raw":        incomingFragment,
		"uri":        uriEncode(incomingFragment),
		"compressed": compressed,
		"declared":   `<?xml version="1.0"?>` + incomingFragment,
	} {
		t.Run(name, func(t *testing.T) {
			out, err := NormalizeSource(in)
			if err != nil {
				t.Fatalf("normalize: %v", err)
			}
			if !strings.HasPrefix(out, "<mxGraphModel") {
				t.Errorf("normalized = %.60q", out)
			}
		})
	}
}

func TestNormalizeSource_RejectsNonDiagramContent(t *testing.T) {
	if _, err := NormalizeSource("just some prose"); err == nil || !strings.Contains(err.Error(), "not a draw.io diagram") {
		t.Fatalf("err = %v", err)
	}
	if _, err := NormalizeSource("   "); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("err = %v", err)
	}
}

func TestImportInto_RejectsAnUnknownMode(t *testing.T) {
	d, _ := ParseDocument(samplePage)
	if _, err := ImportInto(d, "", incomingFragment, ImportMode("merge"), ""); err == nil ||
		!strings.Contains(err.Error(), "import mode must be") {
		t.Fatalf("err = %v", err)
	}
}
