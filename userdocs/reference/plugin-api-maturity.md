---
kind: reference
---

# Plugin API maturity

3 of 13 contribution families are stable; 0 ready to promote; 0 regressed.

| Family | Level | Conformance | Example | E2E | Docs | SDK types | MCP | Code changed | Docs changed | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| canvasObjects | experimental | no | yes | yes | yes | yes | yes | 2026-09-08 | 2026-09-06 | — |
| steps | experimental | no | yes | yes | yes | no | yes | 2026-09-08 | 2026-09-08 | — |
| captures | experimental | no | no | yes | yes | yes | n/a | 2026-09-08 | 2026-09-07 | — |
| settings | stable | yes | yes | yes | yes | yes | n/a | 2026-09-08 | 2026-09-08 | — |
| configuration | experimental | no | yes | no | yes | no | no | 2026-09-08 | 2026-09-08 | — |
| menus | experimental | no | no | no | yes | no | no | 2026-09-08 | 2026-09-08 | — |
| network | experimental | no | yes | yes | yes | yes | n/a | 2026-09-08 | 2026-09-07 | — |
| views | experimental | no | yes | yes | yes | yes | n/a | 2026-09-08 | 2026-09-07 | — |
| commands | stable | yes | yes | yes | yes | yes | yes | 2026-09-08 | 2026-09-08 | — |
| themes | stable | yes | yes | yes | yes | yes | n/a | 2026-09-08 | 2026-09-05 | — |
| secretSources | experimental | no | yes | yes | yes | yes | n/a | 2026-09-08 | 2026-09-07 | — |
| tools | experimental | no | yes | no | yes | no | yes | 2026-09-08 | 2026-09-07 | — |
| mcpServers | experimental | no | yes | no | yes | no | no | 2026-09-08 | — | — |

## How a family moves

A family's level changes only by a decision recorded in an architecture record (ADR-0047, ADR-0048), never by this table alone, however complete its evidence reads. "Ready to promote" is an argument for that decision, not the decision itself. This table regenerates from the repository on every `go generate ./internal/docsgen` and is checked against the committed copy on every build. The control room dashboard renders a live "days behind" figure from the code/docs dates below; this page shows the dates themselves, never that figure, so the committed file never depends on the day it was generated.
