package main

import "github.com/alicoding/mill/internal/domain/runbook"

// RunbookService is the Wails-facing shim over the runbook domain package —
// it holds no logic of its own, just exposes it to the frontend.
type RunbookService struct{}

func (r *RunbookService) List() []runbook.Action {
	return runbook.List()
}

func (r *RunbookService) Run(id string) (string, error) {
	return runbook.Run(id)
}
