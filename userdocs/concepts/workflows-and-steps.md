# Workflows and steps

Copy something from a web page and the seeded Clipboard → Markdown
workflow reads it, converts the HTML, writes the Markdown back to your
clipboard, and notifies you — one trigger, three steps, connected in
order on a canvas. That's every workflow: capture, transform, and act
steps chained after a trigger.

Runs execute the chain durably — a crash or restart resumes where it
left off, and every run is recorded step by step.

## Triggers

Every workflow starts with exactly one trigger — the event that starts
a run: Manual run, Hotkey pressed, On a schedule, Clipboard changed,
File changed, System event, Atlas card changed, or Called by another
workflow (which makes the workflow a callable child with typed inputs).

## Copy and paste steps

Select steps on the canvas and press ⌘C, then ⌘V to paste copies
where your cursor is — configuration included, connections kept when
both ends were copied. The copy is plain text on your clipboard, so
it pastes into another workflow, or another Mill. Trigger steps
don't copy; a workflow has exactly one.

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

Click a step to open its inspector. It opens on **Parameters** — the
step's own setup and nothing else. **Settings** is one click away and
holds how the step behaves: whether it runs, asks or is denied, the
rules that apply to it, and its breakpoint. **Test** runs the step
alone on an input you supply, and shows the selected run's data for
it. Settings carries a count when rules apply and a mark when a
breakpoint is set; Test carries a count when a run recorded data.
Under every tab, one line states what the step takes and produces,
beside a link to the step reference.

Drag the inspector's edge to make it wider, double-click the edge to
reset it, or use the Expand button to give a long value the whole side
of the canvas; the width you choose is remembered on this device.
Fields are typed — pickers for
Configure entities, code editors with highlighting for scripts and
JSON, plain inputs for plain values. A field that names *which
external thing* to talk to (an API, a model, a list) always points at
a Configure entity rather than holding the value inline — see
[Configure entities](configure.md).

## Versions

Saving edits a draft. Publishing snapshots a version — callers and
triggers run the published version, so edits never leak into
production mid-composition.

## Seeing what a step points at

A step that references something you configured — an integration, a
list, an MCP server, an AI provider — shows two links under the
picker. **Details** opens a short summary right there: an
integration's address, method, and auth, and whether its secret is
stored; a list's columns and row count. **Open** takes you to that
entity's own editor: an integration opens as a tab beside your
workflow, everything else opens on its Configure page with the form
ready. If the entity cannot work as it stands — an integration whose
auth has no secret yet — the step says so on the field, with the same
Edit link.
