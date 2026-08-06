package main

import _ "embed"

//go:embed docs/SPEC.md
var specMarkdown string

type SpecService struct{}

func (s *SpecService) Get() string {
	return specMarkdown
}
