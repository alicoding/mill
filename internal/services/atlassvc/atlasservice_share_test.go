package atlassvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// TestCardContextBlock_Fixtures pins CardContextBlock's output against
// committed golden files (mirrors internal/adapters/markdown's own
// ToMarkdown golden-fixture pattern) -- the property under test is
// determinism: the same card state always renders the exact same
// paste-ready bytes, byte for byte, run after run.
func TestCardContextBlock_Fixtures(t *testing.T) {
	tests := []struct {
		name            string
		fixture         string
		withAttachments bool
		build           func(t *testing.T, a *AtlasService) string // returns the card id to render
	}{
		{
			name:    "full card: fields, note, incoming link, source",
			fixture: "full-card",
			build: func(t *testing.T, a *AtlasService) string {
				t.Helper()
				docKind, err := a.CreateKind("Document", "", "", []typedfield.Field{
					{Key: "owner", Label: "Owner", Type: typedfield.TypeText},
					{Key: "pages", Label: "Pages", Type: typedfield.TypeNumber},
				})
				if err != nil {
					t.Fatalf("CreateKind(Document): %v", err)
				}
				contactKind, err := a.CreateKind("Contact", "", "", []typedfield.Field{
					{Key: "email", Label: "Email", Type: typedfield.TypeText},
				})
				if err != nil {
					t.Fatalf("CreateKind(Contact): %v", err)
				}
				linkKind, err := a.CreateLinkKind("relates to", "")
				if err != nil {
					t.Fatalf("CreateLinkKind: %v", err)
				}
				doc, err := a.CreateCard(docKind.ID, "Project charter", "Signed off in Q1.",
					map[string]string{"owner": "Ada Lovelace", "pages": "12"}, "", nil, "",
					"https://example.com/charter", "/tmp/mill-atlas-mirrors/doc.pdf", "")
				if err != nil {
					t.Fatalf("CreateCard(doc): %v", err)
				}
				contact, err := a.CreateCard(contactKind.ID, "Ada Lovelace", "", nil, "", nil, "", "", "", "")
				if err != nil {
					t.Fatalf("CreateCard(contact): %v", err)
				}
				if _, err := a.CreateLink(contact.ID, doc.ID, linkKind.ID, ""); err != nil {
					t.Fatalf("CreateLink: %v", err)
				}
				return doc.ID
			},
		},
		{
			name:            "full card with attachments included",
			fixture:         "full-card-with-attachments",
			withAttachments: true,
			build: func(t *testing.T, a *AtlasService) string {
				t.Helper()
				docKind, err := a.CreateKind("Document", "", "", []typedfield.Field{
					{Key: "owner", Label: "Owner", Type: typedfield.TypeText},
					{Key: "pages", Label: "Pages", Type: typedfield.TypeNumber},
				})
				if err != nil {
					t.Fatalf("CreateKind(Document): %v", err)
				}
				contactKind, err := a.CreateKind("Contact", "", "", []typedfield.Field{
					{Key: "email", Label: "Email", Type: typedfield.TypeText},
				})
				if err != nil {
					t.Fatalf("CreateKind(Contact): %v", err)
				}
				linkKind, err := a.CreateLinkKind("relates to", "")
				if err != nil {
					t.Fatalf("CreateLinkKind: %v", err)
				}
				doc, err := a.CreateCard(docKind.ID, "Project charter", "Signed off in Q1.",
					map[string]string{"owner": "Ada Lovelace", "pages": "12"}, "", nil, "",
					"https://example.com/charter", "/tmp/mill-atlas-mirrors/doc.pdf", "")
				if err != nil {
					t.Fatalf("CreateCard(doc): %v", err)
				}
				contact, err := a.CreateCard(contactKind.ID, "Ada Lovelace", "", nil, "", nil, "", "", "", "")
				if err != nil {
					t.Fatalf("CreateCard(contact): %v", err)
				}
				if _, err := a.CreateLink(contact.ID, doc.ID, linkKind.ID, ""); err != nil {
					t.Fatalf("CreateLink: %v", err)
				}
				return doc.ID
			},
		},
		{
			name:    "minimal card: no fields, no note, no links, no source",
			fixture: "minimal-card",
			build: func(t *testing.T, a *AtlasService) string {
				t.Helper()
				spaceKind, err := a.CreateKind("Space", "", "", nil)
				if err != nil {
					t.Fatalf("CreateKind(Space): %v", err)
				}
				card, err := a.CreateCard(spaceKind.ID, "My space", "", nil, "", nil, "", "", "", "")
				if err != nil {
					t.Fatalf("CreateCard: %v", err)
				}
				return card.ID
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := newBlankAtlasService(t)
			cardID := tt.build(t, a)

			goldenBytes, err := os.ReadFile(filepath.Join("testdata", "share", tt.fixture+".golden.txt"))
			if err != nil {
				t.Fatalf("reading golden: %v", err)
			}
			want := strings.TrimSuffix(string(goldenBytes), "\n")

			got, err := a.CardContextBlock(cardID, tt.withAttachments)
			if err != nil {
				t.Fatalf("CardContextBlock: %v", err)
			}
			if got != want {
				t.Errorf("CardContextBlock(%s) mismatch\ngot:\n%s\nwant:\n%s", tt.fixture, got, want)
			}

			// Determinism: calling twice against unchanged state
			// produces byte-identical output.
			again, err := a.CardContextBlock(cardID, tt.withAttachments)
			if err != nil {
				t.Fatalf("CardContextBlock (second call): %v", err)
			}
			if again != got {
				t.Errorf("CardContextBlock is not deterministic across repeated calls")
			}
		})
	}
}

// newBlankAtlasService returns a fresh AtlasService with the seeded
// example space TOMBSTONED away first -- unlike newTestAtlasService
// (used elsewhere in this package), the share tests above build their
// own minimal fixtures and must not have the seeded cards/kinds
// competing for SpaceBundleContext/SpaceLinksList's root-level results.
func newBlankAtlasService(t *testing.T) *AtlasService {
	t.Helper()
	a := newTestAtlasService(t)
	for _, c := range a.Cards() {
		if c.ParentID == "" {
			if err := deleteCardTree(a, c.ID); err != nil {
				t.Fatalf("clearing seeded root card %q: %v", c.ID, err)
			}
		}
	}
	for _, k := range a.Kinds() {
		_ = a.DeleteKind(k.ID)
	}
	for _, lk := range a.LinkKinds() {
		_ = a.DeleteLinkKind(lk.ID)
	}
	return a
}

// deleteCardTree removes id and every descendant, deepest first --
// DeleteCard refuses to remove a card that still has children.
func deleteCardTree(a *AtlasService, id string) error {
	for _, c := range a.Cards() {
		if c.ParentID == id {
			if err := deleteCardTree(a, c.ID); err != nil {
				return err
			}
		}
	}
	return a.DeleteCard(id)
}

func TestSpaceBundleContext_ConcatenatesChildrenInStableOrder(t *testing.T) {
	a := newBlankAtlasService(t)
	kind, err := a.CreateKind("Topic", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	space, err := a.CreateCard(kind.ID, "Space", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(space): %v", err)
	}
	first, err := a.CreateCard(kind.ID, "First", "", nil, space.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(first): %v", err)
	}
	second, err := a.CreateCard(kind.ID, "Second", "", nil, space.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(second): %v", err)
	}

	got, err := a.SpaceBundleContext(space.ID, false)
	if err != nil {
		t.Fatalf("SpaceBundleContext: %v", err)
	}
	firstBlock, err := a.CardContextBlock(first.ID, false)
	if err != nil {
		t.Fatalf("CardContextBlock(first): %v", err)
	}
	secondBlock, err := a.CardContextBlock(second.ID, false)
	if err != nil {
		t.Fatalf("CardContextBlock(second): %v", err)
	}
	want := firstBlock + "\n\n---\n\n" + secondBlock
	if got != want {
		t.Errorf("SpaceBundleContext = %q, want %q", got, want)
	}
}

func TestSpaceBundleContext_EmptySpace_ReturnsEmptyString(t *testing.T) {
	a := newBlankAtlasService(t)
	kind, err := a.CreateKind("Topic", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	space, err := a.CreateCard(kind.ID, "Empty space", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	got, err := a.SpaceBundleContext(space.ID, false)
	if err != nil {
		t.Fatalf("SpaceBundleContext: %v", err)
	}
	if got != "" {
		t.Errorf("SpaceBundleContext(empty space) = %q, want empty string", got)
	}
}

func TestSpaceBundleContext_UnknownSpace_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if _, err := a.SpaceBundleContext("does-not-exist", false); err == nil {
		t.Error("SpaceBundleContext(unknown id) = nil error, want an error")
	}
}

func TestSpaceLinksList_OnlyCardsWithSourceListedOnePerLine(t *testing.T) {
	a := newBlankAtlasService(t)
	kind, err := a.CreateKind("Topic", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	space, err := a.CreateCard(kind.ID, "Space", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(space): %v", err)
	}
	if _, err := a.CreateCard(kind.ID, "No source", "", nil, space.ID, nil, "", "", "", ""); err != nil {
		t.Fatalf("CreateCard(no source): %v", err)
	}
	if _, err := a.CreateCard(kind.ID, "With source A", "", nil, space.ID, nil, "", "https://a.example.com", "", ""); err != nil {
		t.Fatalf("CreateCard(A): %v", err)
	}
	if _, err := a.CreateCard(kind.ID, "With source B", "", nil, space.ID, nil, "", "https://b.example.com", "", ""); err != nil {
		t.Fatalf("CreateCard(B): %v", err)
	}

	got, err := a.SpaceLinksList(space.ID)
	if err != nil {
		t.Fatalf("SpaceLinksList: %v", err)
	}
	want := "https://a.example.com\nhttps://b.example.com"
	if got != want {
		t.Errorf("SpaceLinksList = %q, want %q", got, want)
	}
}

// --- mirror folders + reveal ---

func TestSpaceFolderPathLocked_NoMirrorsDirConfigured_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if _, err := a.RevealSpaceFolder(""); err == nil {
		t.Error("RevealSpaceFolder with no mirrors dir configured = nil error, want an error")
	}
}

func TestRevealSpaceFolder_CreatesFolderNamedByCardID(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetMirrorsDir(t.TempDir())
	kind, err := a.CreateKind("Topic", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	space, err := a.CreateCard(kind.ID, "Space", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	dir, err := a.RevealSpaceFolder(space.ID)
	if err != nil {
		t.Fatalf("RevealSpaceFolder: %v", err)
	}
	if filepath.Base(dir) != space.ID {
		t.Errorf("mirror folder = %q, want its base name to be the space card's own id %q", dir, space.ID)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Errorf("RevealSpaceFolder did not create %q as a directory: %v", dir, err)
	}
}

func TestRevealSpaceFolder_RootSpace_UsesRootFolderName(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetMirrorsDir(t.TempDir())
	dir, err := a.RevealSpaceFolder("")
	if err != nil {
		t.Fatalf("RevealSpaceFolder(root): %v", err)
	}
	if filepath.Base(dir) != "root" {
		t.Errorf("root mirror folder = %q, want base name %q", dir, "root")
	}
}

func TestRevealCardMirror_NoMirrorPath_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	kind, err := a.CreateKind("Document", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	card, err := a.CreateCard(kind.ID, "No mirror", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if err := a.RevealCardMirror(card.ID); err == nil {
		t.Error("RevealCardMirror on a card with no MirrorPath = nil error, want an error")
	}
}

func TestRevealCardMirror_UnknownCard_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if err := a.RevealCardMirror("does-not-exist"); err == nil {
		t.Error("RevealCardMirror(unknown id) = nil error, want an error")
	}
}
