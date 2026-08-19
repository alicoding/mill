# Workflows and steps

A workflow is a chain of steps on a canvas: one trigger, then capture,
transform, and act steps connected in order. Runs execute the chain
durably — a crash or restart resumes where it left off, and every run
is recorded step by step.

## Triggers

Every workflow starts with exactly one trigger — the event that starts
a run: Manual run, Hotkey pressed, On a schedule, Clipboard changed,
File changed, System event, Atlas card changed, or Called by another
workflow (which makes the workflow a callable child with typed inputs).

## The step contract

Every step declares what it consumes and what it produces — a coarse
payload kind: text, HTML, Markdown, JSON, anything, or nothing. The
card shows it (`HTML → Markdown`), the inspector spells it out
("Takes: HTML — Produces: Markdown"), and connecting a step to one
that can't accept its output is refused at draw time with a plain
explanation. Steps that forward their input unchanged (like Notify me
or Validate with rules) say so.

Data flows two ways through a run:

- **The payload** — one running artifact the chain transforms (the
  clipboard HTML that becomes Markdown).
- **Attributes** — named, typed fields a workflow declares. Steps
  read and write them by name (an AI classification lands in an
  attribute; Branch routes on one). They're the structured half.

## Configuring a step

Click a step to open its inspector. Fields are typed — pickers for
Configure entities, code editors with highlighting for scripts and
JSON, plain inputs for plain values. A field that names *which
external thing* to talk to (an API, a model, a list) always points at
a Configure entity rather than holding the value inline — see
[Configure entities](configure.md).

## Versions

Saving edits a draft. Publishing snapshots a version — callers and
triggers run the published version, so edits never leak into
production mid-composition.
