# What is Mill

Mill is a desktop app for building guardrailed automations — workflows
you compose from typed steps, run by hotkey, schedule, or watcher, with
every risky action gated for your approval.

Three ideas carry the whole product:

**Workflows are visible machines.** A workflow is a chain of steps on a
canvas. Every step declares what it takes and what it produces (shown
right on its card, like `HTML → Markdown`), so a workflow reads like a
sentence, and connecting steps that can't work together is refused with
an explanation at the moment you try.

**Nothing external happens without a gate.** Every step carries an
effect class — reading your clipboard is not the same as calling an
API. Steps with external effects park their run and ask for approval by
default; you decide once, or write a guardrail rule that decides for
you, scoped exactly as narrowly as you want.

**Agents are first-class users.** Mill exposes everything a human can
do through an MCP server, with the same guardrails. An AI agent can
compose, run, and inspect workflows on your behalf — and its writes
wait for your approval exactly like any other external effect. Mill
itself never calls an AI API and never phones home: it is the workbench
agents use, not an agent.

Mill is a single binary. Your data stays in local files you can back
up, export, and inspect. Install it by cloning the repository and
building, or grab a release — see [Install](install.md).
