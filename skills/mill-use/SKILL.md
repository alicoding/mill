---
name: mill-use
description: Drive Mill (guardrailed workflow automation + Atlas knowledge board) over MCP — compose, run, and inspect workflows; read and write Atlas; respect the approval gate. Use when connected to a Mill MCP server or asked to automate through Mill.
---

# Using Mill as an agent

Mill is a local desktop app exposing its full surface over MCP. You
get what the human gets — same tools, same guardrails. Full product
docs in one file: `userdocs/llms-full.txt` in the Mill repository.

## Connect

The human finds their address under Settings → MCP access (default
`http://127.0.0.1:8091/mcp`). Writes may be deny-all until they
enable agent access there.

## The mental model

- A **workflow** = one trigger + connected steps. Every step has a
  typed contract: what payload kind it consumes and produces
  (text/html/markdown/json/any/none, or passthrough). Read the
  registry resource before composing — the server validates edges
  against these contracts and rejects definite mismatches with the
  reason.
- **Payload** = the single artifact flowing through a run.
  **Attributes** = the workflow's declared typed fields; steps read
  and write them by name. Structured data goes in attributes.
- **Configure entities** (integrations, lists, MCP servers, AI
  providers, execution environments) are referenced by ID from
  steps. Create or look them up first; never inline a secret —
  secrets live in the OS keychain via the entity's credential field.
- **Effect classes**: steps marked external PARK the run for human
  approval unless a guardrail rule allows them. Expect runs to sit
  in `parked` state; that is working-as-designed, not an error.
  Never attempt to bypass a gate; surface the pending approval to
  the human instead.

## The working loop

0. Tool arguments use the EXPORTED-WORKFLOW JSON envelope: workflow
   tools take a `json` string in the same shape `export_workflow`
   returns (steps/edges arrays with `nodeTypeId`), not an inline
   object — export a seeded workflow once and mirror its shape.
1. List step types / read the registry resource; check each step's
   Takes/Produces before wiring.
2. Author or update the workflow (IDs are stable; labels are yours).
3. Validate — fix any issue the server reports (they name the step
   and edge).
4. Run with `test: true` while iterating (excluded from the human's
   production metrics); use the stepped-run tool to debug one step
   at a time. Production runs omit the flag.
5. Inspect the run's step records — each carries input, output, and
   failure text prefixed by the failing step's ID.

## Testing an integration

`test_request` executes ONE real HTTP call -- the Configure Try-it
panel's agent twin. Pass `requestId` to test a configured
integration (stored config and secret fill in) or the full draft
inline (`baseUrl`/`authType`/`secret`/`openApiSpec`). Nothing is
persisted, but it is still a gated write (a real outbound call):
poll `check_write_status` for the statusCode/body result. Test a
draft BEFORE proposing its import.

## Atlas

Cards are typed by kinds; links by link kinds, unique per
(from, to, kind). Mirrored markdown renders in cards (mermaid fences
included). Prefer updating existing cards (match by source URL or
ID) over creating duplicates; card writes are gated like any write.
Kinds themselves are writable via `atlas_propose_kind_write`
(create/update/delete, gated): on update, omit `fields` to keep the
existing schema -- a provided list must retain every saved key, and
deleting a kind is refused while any live card uses it.

## Conduct

- Ask the registry, don't assume: step IDs and contracts are the
  source of truth, and they evolve.
- Small validated changes over big blind ones; leave workflows
  publishable (the human runs the published version).
- Anything ambiguous about intent, data destinations, or approvals
  is the human's call — park and ask.
