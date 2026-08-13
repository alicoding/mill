# Goal 0047 — Node audience/complexity facet

Owner-proposed 2026-08-13: categorize nodes by target user audience.
Owner's framing sharpened in the same conversation: the market splits
at the PRODUCT level (non-devs converge on Zapier-class tools,
engineers on n8n-class ones) — a single-experience product loses one
audience entirely. Mill already carries both altitudes structurally:
the Quick Panel / seeded-examples / approve-deny surface is the
consume-and-run altitude, the canvas / MCP / code-exec surface is the
authoring altitude. This goal's job is to keep ONE product serving
both (progressive disclosure bridging them), never to pick a side via
labels — the positioning consequence belongs in SPEC's audience
section at pickup.
Session recommendation (to confirm or override at pickup): keep
FUNCTION as the palette's primary grouping (goal 0001 design wave 3's
9-group IA) and make audience/complexity a FACET, not a parallel
taxonomy — the precedent pattern is progressive disclosure ("show
advanced"), not "for business users" labels, which age badly and
misfit real people who straddle audiences. The enterprise-shaped
second half of the idea is governance, not display: WHO MAY USE a
node class (code-execution, raw HTTP, MCP) is a guardrail/policy
question — deferred until multi-user exists, but the same metadata
enables it.

## Plan (three tiers, only the first two in this goal)

1. `NodeType` gains an audience/complexity metadata field (exact
   name/enum decided at pickup — e.g. `Complexity: basic|advanced`),
   set for every registered node, enforced by the existing
   node-standard machine checks (`TestNodeTypes`) so a new node can't
   omit it. `.claude/rules/node-standard.md` gains the item.
2. Palette + ⌘K surface it as progressive disclosure (an
   "advanced" filter/toggle or search facet) — UX shape decided
   against the live palette, not speculated; ship only if the node
   count/scan cost justifies it at build time (anti-proliferation:
   the metadata is cheap; the toggle must earn its pixels).
3. DEFERRED with trigger: policy-gated node availability per
   user/role — when Mill has multi-user or admin-managed
   distribution; the field from (1) is its enabler. Recorded here so
   it isn't re-invented.

## Acceptance (checkable)

- [ ] Every registered NodeType carries the new field; TestNodeTypes
      fails on omission; node-standard.md documents it.
- [ ] The palette/⌘K facet shipped OR explicitly rejected-with-reason
      here after checking against the live palette's actual scan
      cost.
- [ ] SPEC.md's node/palette section updated in the same change.
