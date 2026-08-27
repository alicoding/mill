# Runs, review, and debugging

Mill crashes or restarts mid-workflow, and the run picks up where it
left off instead of vanishing. Open the workflow's **Runs** tab
afterward and every run is there step by step — inputs, outputs,
timing, and exactly where it stopped.

## When a run needs a person

**Review** is the one queue for everything waiting on you:

- **Guardrail asks** — an external-effect step parked for approval.
- **Human review steps** — a workflow deliberately pauses for your
  verdict, optionally collecting typed input that flows back into
  the run.
- **Agent writes** — changes an AI agent proposed over MCP, held
  until you approve.

Each entry shows exactly what will happen and how old the ask is.
When you're away, Mill escalates: an actionable notification, a dock
badge, and a floating approval prompt.

## Debugging a workflow

- **Test runs** from the editor execute the draft without counting
  as production activity.
- **Breakpoints** pause a run before a step; edit values, then
  resume — or run in step mode and walk the chain one step at a
  time.
- **Try it** on the Convert HTML to Markdown step previews a
  conversion without running anything.
- **Activity** shows trigger fires and run outcomes across all
  workflows, so a scheduled or watching workflow is never invisibly
  running. Its MCP calls section logs every call to or from Mill's
  agent connection — who called what, when, and what happened.
