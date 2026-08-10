# 0010 — Seed-proof completeness + enforcement

## Goal
Close the gap the owner named directly ("I don't know if we have
coverage to prove everything is working other than me confirming the
UX") — confirmed real by a full audit (2026-08-10): 6/9 seeded
workflows are genuinely proven (real seed, real DBOS, Go + e2e);
the rest lean on the owner's eyes. "Is everything proven?" must
become a question CI answers.

## Audit findings (the work items)
1. [ ] `example-guarded-http-workflow`: no Go test runs the REAL seed
   (all guardrail Go tests use a look-alike fixture). Add
   approve+deny seed tests against real DBOS.
2. [ ] `example-disabled-schedule-workflow`: zero tests beyond
   structural. Add: triggered-run rejected, test-run works, enabling
   arms the schedule (nothing OS-dependent here).
3. [ ] Seven seeded HTTPRequests: no committed test performs any live
   round trip (hand-verified at development time only; the e2e's own
   header admits it). Fix WITHOUT breaking no-network-in-blocking-CI:
   an advisory scheduled CI job (govulncheck's own precedent) that
   runs each seed's Test panel path against its live endpoint —
   non-blocking, but the liveness claim stops being historical.
4. [ ] No List seed + no seeded workflow uses `list-lookup`: seed a
   List ("Example: Country codes"?) + a lookup workflow + Go/e2e
   proof — the standard pattern, just never done for Lists.
5. [ ] No MCP Server seed + no seeded workflow uses `mcp-tool-call`:
   seed an MCP Server (the official reference server via `npx` for
   real users) + a workflow; tests point the seam at the existing
   local fixture server (e2e/fixtures/mcp-fixture-server.mjs) for
   determinism.
6. [ ] `trigger-filesystem-watch` has no seed and IS automatable
   (fsnotify works headless): seed a disabled watch example (the
   disabled-schedule precedent — never arms until pointed at a real
   path) + a Go test arming it against a temp dir.
7. [ ] `trigger-hotkey`/`trigger-clipboard-watch`: legitimately
   CI-unautomatable (documented §1.3) — enter the manual-only
   registry below with their reasons, not silently absent.

## The structural fixes (what stops recurrence)
8. [ ] **Enforcement test**: a Go test enumerating every seeded
   artifact (workflows, HTTPRequests, Decisions, future Lists/MCP
   Servers) that FAILS unless each seed ID appears in a proof
   registry — either named automated tests or an explicit
   manual-only entry with its documented reason. A new seed without
   a proof becomes a red build, not a wondering owner.
9. [ ] Same enforcement for node types: every registered NodeType
   must be exercised by at least one seeded workflow or carry a
   registered exemption (with reason). Catches the next
   list-lookup-shaped gap at registration time.

## Acceptance
The enforcement tests exist and pass; every current seed is either
automatically proven or explicitly, reasonedly manual-only; the
advisory liveness job runs; the owner can answer "is it proven?" by
reading CI, not by clicking through the app.
