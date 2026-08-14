package contract

import "embed"

// CommittedSchemas embeds the generated *.schema.json files this
// package's own drift test (contract_test.go) byte-compares against a
// fresh GenerateAll() run -- the committed contract an external agent
// reads travels inside the binary, never off disk at runtime.
//
//go:embed schemas/*.schema.json
var CommittedSchemas embed.FS
