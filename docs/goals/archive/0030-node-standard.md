# 0030 — Node standard: minimum requirements every NodeType meets

## Goal
Owner-mandated 2026-08-12: "define what is a standard for all plugins
going forward including minimum requirement schemas... when I looked
into some nodes it hasn't been reviewed against industry standards."
Adopt (never invent) a node/plugin conformance standard — the checklist
every existing and future NodeType is reviewed against — modeled on the
published standards real platforms enforce (n8n's community-node
verification guidelines are the named precedent to research first).

## Plan
1. [x] Research DONE 2026-08-12 (primary sources: n8n verification/UX/
   error-handling guidelines, Zapier publishing requirements, Raycast
   store checklist — full report in session; key verdicts below).
   Converged 8-item checklist mapped onto Mill: items 1/4/5/6/8 already
   enforced (TestNodeTypes, keyring credentials, seed-per-capability —
   stricter than all three platforms; Effect = a machine-enforced
   version of n8n's no-unscoped-access rule). NEW machine-checkable
   items: (a) ConfigField.Description non-empty; (b) **Effect must be
   explicitly set — the zero value silently becomes ClassNone = NO
   GUARDRAIL GATE, the one dangerous gap** (priority); (c) every
   nodeExec error prefixed with its NodeType ID (already convention,
   un-checked); (d) ID prefixed by Kind's prefix (allow-list for
   pre-pattern IDs); (e) Output non-empty for non-terminal kinds.
   Rejected with reasons: n8n publishing/license ceremony, CRUD
   completeness, Zapier marketing copy, Raycast store assets, and
   Raycast's no-keychain rule (contradicts Mill's deliberate go-keyring
   design). NodeType-level versioning named as real-but-latent — not
   built speculatively.
2. [x] Write the Mill Node Standard: `.claude/rules/node-standard.md`
   (paths-scoped to `internal/domain/composition/**`) — the 8-item
   checklist table (each marked enforced-by-what), the credential rule,
   the explicit rejections (n8n publishing ceremony, CRUD completeness,
   Raycast no-keychain), NodeType-level versioning named latent-not-
   built, and why the error-prefix convention stays review-checked
   rather than grep-tested. `docs/SPEC.md`'s §3.3 capability-map table
   gets a `Node standard` row, `LOCKED`.
3. [x] Conformance audit: every registered NodeType reviewed against
   items (a)/(b)/(c)/(d) via the new `TestNodeTypes` checks (run before
   finalizing any allow-list, per the goal's own instruction). Found and
   fixed 3 real gaps: `list-lookup`/`list-search` had no declared
   `Effect` despite doing a real local List read (fixed to
   `ClassRead`, matching `capture-file`'s precedent); `child-workflow`
   had no declared `Effect` either — fixed to an explicit `ClassNone`
   (ADR-0022 already named this as the correct class, just never
   written down); `decision-route` had no `Output` (fixed — it was the
   only NodeType missing one, so item (d) needs no Kind exemption at
   all, universal). No other violations found.
4. [x] Enforcement where mechanical: `TestNodeTypes`
   (`nodetypes_test.go`) now checks (a) `ConfigField.Description`
   non-empty, (b) `Effect` explicit via a closed `pureNodeTypes`
   allow-list, (c) ID prefixed by its `Kind` via a closed
   `idPrefixExceptions` allow-list (verified against the actual
   registry: `child-workflow`, `code-execution`, `human-review`,
   `ruleset`, `integration-http`, `list-lookup`, `list-search`,
   `mcp-tool-call`, plus `decision-outcome` — a `KindTerminal` node
   named for its pre-ADR-0027 "Decision" identity, found by running the
   check rather than assumed), (d) `Output` non-empty universally. Item
   (e) (error-prefix convention) is documented as review-checked, not
   machine-checked — a grep-over-source test was judged too brittle
   (recorded in the rule file, not silently skipped).

## Acceptance
A written standard citing its precedents; every current NodeType either
conforms or has a named debt entry; a new node's DoR includes the
standard; at least one machine-check enforces the checkable subset.

**Met 2026-08-12.** `.claude/rules/node-standard.md` cites all three
platforms' guideline URLs; `TestNodeTypes` machine-checks 4 of the 8
items with zero outstanding violations (3 real gaps found were fixed
in the same change, not deferred as debt entries); the rule file's
`paths` frontmatter means a future node-authoring session in
`internal/domain/composition/**` gets the standard loaded automatically
as part of its DoR.
