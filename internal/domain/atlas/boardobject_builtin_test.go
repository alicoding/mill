package atlas

import "testing"

// TestBuiltInBoardObjects_ShapeCarriesRotation pins goal 0214's own
// retroactive seed proof: the seeded shape golden carries a nonzero
// Payload["rotation"] in the exact key/format
// atlassvc.SetBoardObjectRotation itself writes, so a fresh install
// demonstrates a rotated shape without any live drag ever happening.
func TestBuiltInBoardObjects_ShapeCarriesRotation(t *testing.T) {
	for _, o := range BuiltInBoardObjects() {
		if o.Kind != "shape" {
			continue
		}
		if o.Payload["rotation"] == "" || o.Payload["rotation"] == "0" {
			t.Errorf("seeded shape %q Payload[rotation] = %q, want a nonzero angle", o.ID, o.Payload["rotation"])
		}
		return
	}
	t.Fatal("no seeded shape board object found")
}

// TestBuiltInBoardObjects_FileBackedGoldensNameAResolvableAsset proves
// every file-backed golden's BoardObjectSeedAssetKey resolves through
// BuiltInBoardObjectAsset -- the property builtInBoardObjectsLocked
// (atlassvc) relies on to materialize a real mirror file for it.
func TestBuiltInBoardObjects_FileBackedGoldensNameAResolvableAsset(t *testing.T) {
	found := 0
	for _, o := range BuiltInBoardObjects() {
		asset := o.Payload[BoardObjectSeedAssetKey]
		if asset == "" {
			continue
		}
		found++
		content, ext, ok := BuiltInBoardObjectAsset(asset)
		if !ok {
			t.Errorf("seeded board object %q names unresolvable asset %q", o.ID, asset)
			continue
		}
		if content == "" || ext == "" {
			t.Errorf("seeded board object %q asset %q resolved to empty content/ext", o.ID, asset)
		}
		if o.Payload["mirrorPath"] != "" {
			t.Errorf("seeded board object %q carries a mirrorPath before materialization -- domain package must stay persistence-free", o.ID)
		}
	}
	if found == 0 {
		t.Fatal("no file-backed seeded board object found")
	}
}

// TestBuiltInBoardObjectAsset_UnknownKeyIsHonestlyUnresolved proves an
// unrecognized asset key returns ok=false rather than empty content
// silently passing as valid.
func TestBuiltInBoardObjectAsset_UnknownKeyIsHonestlyUnresolved(t *testing.T) {
	if _, _, ok := BuiltInBoardObjectAsset("not-a-real-asset"); ok {
		t.Error("BuiltInBoardObjectAsset(bogus key) = ok true, want false")
	}
}
