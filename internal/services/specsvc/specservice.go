// Package specsvc exposes docs/SPEC.md's rendered-in-app content
// (the Spec view) as a Wails-bound service. The markdown itself is
// embedded by main.go (//go:embed can't reach a parent directory, so
// the embed directive has to live at the repo root next to docs/) and
// injected here at construction.
package specsvc

// SpecService serves the embedded SPEC.md content to the frontend.
type SpecService struct {
	markdown string
}

// New builds a SpecService serving the given markdown -- main.go passes
// its own //go:embed'ed docs/SPEC.md content.
func New(markdown string) *SpecService {
	return &SpecService{markdown: markdown}
}

// Get returns the full SPEC.md markdown.
func (s *SpecService) Get() string {
	return s.markdown
}
