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
2. [ ] Write the Mill Node Standard (a rules/ file or docs/ page +
   ADR): minimum per-NodeType requirements — typed ConfigFields with
   descriptions/defaults, declared effect class, Output description,
   payload contract documented, error semantics (fail-safe, named
   errors with remedies), seeded proof at the right layer, SPEC row,
   naming conventions (Kind prefixes, label style), Inspector UX bar
   (no raw-JSON-only config where typed fields are expressible).
3. [ ] Conformance audit: every existing NodeType reviewed against the
   standard; gaps become checklist items fixed in the same wave or
   recorded as explicit debt entries (delivery-discipline rule).
4. [ ] Enforcement where mechanical: extend seedproof-style checks if
   any standard item is machine-checkable (e.g. every NodeType has a
   nonempty Description + effect class — a Go test over the registry).

## Acceptance
A written standard citing its precedents; every current NodeType either
conforms or has a named debt entry; a new node's DoR includes the
standard; at least one machine-check enforces the checkable subset.
