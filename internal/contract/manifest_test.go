package contract_test

import (
	"testing"

	"github.com/alicoding/mill/internal/contract"
	_ "github.com/alicoding/mill/internal/services/compositionsvc"
	_ "github.com/alicoding/mill/internal/services/configuresvc"
)

// TestBuildManifest_ReflectsGivenBuildInfo pins the field mapping
// between a raw build-info reading and the served Manifest --
// version/commit/modified pass through unchanged, server maps to the
// "server"/"desktop" mode string, and the schema list matches the same
// registry SchemaID/Families already expose.
func TestBuildManifest_ReflectsGivenBuildInfo(t *testing.T) {
	m := contract.BuildManifest("1.2.3", "deadbeef1234", true, false)
	if m.Version != "1.2.3" {
		t.Errorf("Version = %q, want %q", m.Version, "1.2.3")
	}
	if m.Commit != "deadbeef1234" {
		t.Errorf("Commit = %q, want %q", m.Commit, "deadbeef1234")
	}
	if !m.Modified {
		t.Error("Modified = false, want true")
	}
	if m.Mode != "desktop" {
		t.Errorf("Mode = %q, want %q (server=false)", m.Mode, "desktop")
	}

	families := contract.Families()
	if len(m.Schemas) != len(families) {
		t.Fatalf("Schemas has %d entries, want %d (one per registered family)", len(m.Schemas), len(families))
	}
	for i, f := range families {
		if m.Schemas[i].Family != f {
			t.Errorf("Schemas[%d].Family = %q, want %q", i, m.Schemas[i].Family, f)
		}
		if m.Schemas[i].Major != contract.SchemaMajor {
			t.Errorf("Schemas[%d].Major = %d, want %d", i, m.Schemas[i].Major, contract.SchemaMajor)
		}
		if m.Schemas[i].ID != contract.SchemaID(f) {
			t.Errorf("Schemas[%d].ID = %q, want %q", i, m.Schemas[i].ID, contract.SchemaID(f))
		}
	}
}

// TestBuildManifest_ServerMode pins the server=true -> Mode="server"
// mapping the desktop case above doesn't exercise.
func TestBuildManifest_ServerMode(t *testing.T) {
	m := contract.BuildManifest("1.2.3", "", false, true)
	if m.Mode != "server" {
		t.Errorf("Mode = %q, want %q (server=true)", m.Mode, "server")
	}
}
