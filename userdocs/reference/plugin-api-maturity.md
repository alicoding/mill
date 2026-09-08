---
kind: reference
---

# Plugin API maturity

3 of 11 contribution families are stable; 0 ready to promote; 0 regressed.

| Family | Level | Conformance | Example | E2E | Docs | SDK types | MCP | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| canvasObjects | experimental | no | yes | yes | yes | yes | yes | — |
| steps | experimental | no | yes | yes | yes | no | yes | — |
| captures | experimental | no | no | yes | yes | yes | n/a | — |
| settings | stable | yes | yes | yes | yes | yes | n/a | — |
| network | experimental | no | yes | yes | yes | yes | n/a | — |
| views | experimental | no | yes | yes | yes | yes | n/a | — |
| commands | stable | yes | yes | yes | yes | yes | yes | — |
| themes | stable | yes | yes | yes | yes | yes | n/a | — |
| secretSources | experimental | no | yes | yes | yes | yes | n/a | — |
| tools | experimental | no | yes | no | yes | no | yes | — |
| mcpServers | experimental | no | yes | no | yes | no | no | — |

## How a family moves

A family's level changes only by a decision recorded in an architecture record (ADR-0047, ADR-0048), never by this table alone, however complete its evidence reads. "Ready to promote" is an argument for that decision, not the decision itself. This table regenerates from the repository on every `go generate ./internal/docsgen` and is checked against the committed copy on every build. The control room dashboard renders each family's code/docs currency and a live "days behind" figure derived from it; this page never carries either, so the committed file never depends on the checkout it was generated from.
