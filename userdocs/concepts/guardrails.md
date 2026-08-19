# Guardrails and effect classes

Every step type declares an effect class — what kind of touch it has
on the world:

- **None** — pure computation, nothing outside the run.
- **Read** — reads local state (a file, a list, the clipboard).
- **Local** — changes something on this machine (writes the
  clipboard, moves a file, shows a notification).
- **External** — leaves the machine (an API call, an MCP tool).

**External is guarded by default.** A run reaching an external step
parks and asks for your approval — in the app, and with an actionable
notification when you're away. Nothing you didn't approve leaves the
machine.

## Deciding once, or by rule

Approving every run gets old for a step you trust. Configure →
Guardrails holds rules: allow or deny, scoped as narrowly as you want —
a specific workflow, a specific step, a matching condition. Rules can
be dry-run against past asks before you rely on them.

A rule that cannot evaluate counts as failed — ambiguity never
silently allows.

## Where asks live

Parked runs appear in the workflow's Runs tab and in **Review**, the
queue for everything waiting on a person: guardrail asks, human-review
steps, and agent writes. Each ask shows what will happen and how old
the request is. Approve resumes the run; deny stops it, recorded.

Local-effect steps run without a gate — the notification saying your
markdown is ready shouldn't itself need approval. AI steps pointed at
a localhost model run ungated too; the same step pointed at a remote
endpoint is external and asks.
