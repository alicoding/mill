---
name: working-with-mill
description: How to work with Mill — a desktop app for guardrailed, human-approved automations and a knowledge map called the Atlas. Read this before authoring workflows, proposing Atlas changes, or calling any write tool; it tells you which tool fits which job, how approvals behave, and the mistakes that waste turns.
---

# Working with Mill

Mill is a local desktop app. You are talking to it over MCP (or a
pasted context envelope). Three facts shape everything:

1. **Reads are free; writes are proposals.** Every read tool answers
   immediately. Every write parks for the human's approval — your call
   returns "parked pending human approval" with an id. That is
   success, not an error: poll the matching status tool for the
   outcome (approved / denied / expired). Never retry a parked write;
   never treat "parked" as failure.
2. **What you see is what Mill sees.** Read tools and resources return
   Mill's actual state. Do not assume entities exist — read the index
   first, then act on ids you were given. Fabricated ids fail
   validation, never silently create.
3. **The human is the authority.** A denial is information: re-plan or
   ask, don't re-submit the same write.

## Which door for which job

- **Know what exists**: read `mill://manifest` (this build's version +
  schema families), then the indexes — `mill://workflows`,
  `mill://requests`, `mill://lists`, `mill://mcpservers`,
  `mill://aiproviders`, `mill://atlas/cards`. Each index row names the
  per-item resource (`mill://workflows/{id}` etc.) for full detail.
- **Full reference** (every envelope schema, the step-type catalog,
  the import/update rules): read `mill://contract` — the complete
  machine contract in one document. Read it before authoring a
  workflow import; do not guess step config shapes.
- **Human documentation** (concepts, guides, the why): the app ships
  it under Docs; the same content is exported as llms-full.txt via
  the Settings → Contract section for offline handoff.

## Working with workflows

- A workflow is a typed graph: trigger → steps → outputs. Every step
  declares inputs/outputs; the contract lists every step type with
  its config fields. Validation is strict and helpful — a rejected
  import names the failing step and field.
- Author by IMPORT (the gated import tools), never by trying to edit
  files. Import parks for approval like any write. Start from an
  existing workflow's export (`mill://workflows/{id}`) when extending;
  exact shapes beat invention.
- Values that name an external thing (a credential, an endpoint, a
  model, a list) are references to Configure entities — reuse an
  existing entity id from the indexes; never inline a secret anywhere
  (Mill stores secrets in the OS keychain; exports never contain
  them, and imports never accept them).
- Test-running a workflow and production-running it are distinct run
  kinds; use the run tool's flags as documented in the contract.

## Working with the Atlas

- The Atlas is a map of typed cards (kinds declare fields), links,
  and containment (cards nest in spaces). Read the declared kinds
  via the atlas tools before proposing cards: a proposed card's kind
  and field keys must match a declared kind exactly.
- Propose cards/notes with the atlas write tools; proposals park.
  Card creation does not check for an existing card with the same
  title — search first (the atlas search tool) so you don't create an
  unintentional duplicate. Empty proposals ("nothing to add") are
  valid; say so instead of inventing content.

## Reply envelopes (when you're pasted a context envelope instead of MCP)

A pasted Mill context document carries its own reply schema inline.
Answer with EXACTLY ONE raw JSON object matching that schema — no
markdown fences, no prose around it, no XML. The same action taxonomy
applies: your reply is a proposal the human reviews.

## Etiquette that saves turns

- Read before you write; state your plan in one sentence when a task
  is multi-step.
- One write proposal per logical change; batch items INSIDE one
  proposal rather than many single-item proposals.
- On denial or validation failure, adjust from the error text — it is
  specific on purpose.
- Never ask the human for secrets or tokens; point them at Configure.
- If a tool you expect is missing, read the contract's catalog rather
  than inventing a tool name.
