package main

import (
	"os"

	"github.com/alicoding/mill/internal/domain/capabilities"
)

// CapabilitiesService is the Wails-bound projection of Mill's own
// capability registry (internal/domain/capabilities) -- a thin binding
// layer, same shape as CompositionService/TriggerService, no logic of
// its own beyond exposing the domain package's data to the frontend.
type CapabilitiesService struct{}

func (c *CapabilitiesService) List() []capabilities.Capability {
	return capabilities.List()
}

// RepoPath returns the working directory the binary was launched from,
// so the frontend can build an editor deep link (vscode://file/...) for
// capabilities with an EditorPath. Only meaningful in dev mode: task dev
// launches the binary with the repo root as cwd (confirmed this
// session), but a real installed build has no source tree to jump to at
// all -- the frontend gates every call behind import.meta.env.DEV.
func (c *CapabilitiesService) RepoPath() string {
	wd, _ := os.Getwd()
	return wd
}
