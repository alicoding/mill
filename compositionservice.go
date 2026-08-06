package main

import "github.com/alicoding/mill/internal/domain/composition"

// CompositionService is the Wails-facing shim over the composition
// domain package -- it holds no logic of its own, just exposes it to
// the frontend. See docs/SPEC.md §3's `UX: PROTOTYPE` entry for what
// this is testing.
type CompositionService struct{}

func (c *CompositionService) NodeTypes() []composition.NodeType {
	return composition.NodeTypes()
}

func (c *CompositionService) Recipes() []composition.Recipe {
	return composition.Recipes()
}

func (c *CompositionService) RunRecipe(id string) (string, error) {
	return composition.RunRecipe(id)
}
