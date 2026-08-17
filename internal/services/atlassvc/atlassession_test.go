package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestAtlasSession_RoundTripsAndDegrades(t *testing.T) {
	store := servicetest.NewFakeStore()
	a := NewAtlasService(store)
	card, err := a.CreateCard(a.Kinds()[0].ID, "Session host", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.SetAtlasSession(AtlasSessionState{ViewedID: card.ID, OpenCardID: card.ID}); err != nil {
		t.Fatal(err)
	}

	b := NewAtlasService(store)
	got := b.AtlasSession()
	if got.ViewedID != card.ID || got.OpenCardID != card.ID {
		t.Fatalf("restored session = %+v, want both %q", got, card.ID)
	}

	// Degrade: the viewed/open card is deleted -> root + no open card,
	// never a stale id.
	if err := b.DeleteCard(card.ID); err != nil {
		t.Fatal(err)
	}
	got = b.AtlasSession()
	if got.ViewedID != "" || got.OpenCardID != "" {
		t.Fatalf("degraded session = %+v, want zero", got)
	}
}

// The MILL_TEST_ATLAS_SESSION_OFF seam suppresses the read-back only:
// writes persist, but a shared-server e2e page must always mount from
// the zero state.
func TestAtlasSession_EnvOffSuppressesReadBack(t *testing.T) {
	svc := NewAtlasService(servicetest.NewFakeStore())
	if err := svc.SetAtlasSession(AtlasSessionState{ViewedID: "anything"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MILL_TEST_ATLAS_SESSION_OFF", "1")
	if got := svc.AtlasSession(); got.ViewedID != "" || got.OpenCardID != "" {
		t.Fatalf("session with kill-switch = %+v, want zero", got)
	}
}
