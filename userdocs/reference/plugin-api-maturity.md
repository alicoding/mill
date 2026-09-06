---
kind: reference
---

# Plugin API maturity

3 of 11 contribution families are stable; 0 ready to promote; 0 regressed.

| Family | Level | Conformance | Example | E2E | Docs | SDK types | MCP | Docs behind code (days) | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| canvasObjects | experimental | no | yes | yes | yes | yes | yes | 1 | — |
| steps | experimental | no | yes | yes | yes | no | yes | 2 | — |
| captures | experimental | no | no | yes | yes | yes | n/a | 0 | — |
| settings | stable | yes | yes | yes | yes | yes | n/a | 1 | — |
| network | experimental | no | yes | yes | yes | yes | n/a | 0 | — |
| views | experimental | no | yes | yes | yes | yes | n/a | 0 | — |
| commands | stable | yes | yes | yes | yes | yes | yes | 1 | — |
| themes | stable | yes | yes | yes | yes | yes | n/a | 2 | — |
| secretSources | experimental | no | yes | yes | yes | yes | n/a | 0 | — |
| tools | experimental | no | yes | no | yes | no | yes | 0 | — |
| mcpServers | experimental | no | yes | no | yes | no | no | 0 | — |

## How a family moves

A family's level changes only by a decision recorded in an architecture record (ADR-0047, ADR-0048), never by this table alone, however complete its evidence reads. "Ready to promote" is an argument for that decision, not the decision itself. This table regenerates from the repository on every `go generate ./internal/docsgen` and is checked against the committed copy on every build.
