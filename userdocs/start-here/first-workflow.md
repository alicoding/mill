# Your first workflow

Mill ships with working examples, and the fastest way to understand it
is to run one, then rebuild it yourself.

## Run the seeded one

1. Open **Workflows**. Find **Clipboard → Markdown** — it captures
   whatever HTML is on your clipboard, converts it to Markdown, writes
   the result back to the clipboard, and notifies you when it's done.
2. Copy something from a web page.
3. Click **Run** on the workflow. Paste anywhere: you'll get Markdown.

Every example named `Example: …` demonstrates one capability the same
way — open any of them on the canvas to read how it works.

## Build it yourself

1. **Workflows → New workflow.** A Manual run trigger is already on
   the canvas — every workflow starts with exactly one trigger.
2. Click **+ Add step**. Search `clipboard` and drag **Read
   clipboard** onto the canvas. Connect the trigger to it.
3. Add **Convert HTML to Markdown** and connect it. Notice the card
   says `HTML → Markdown` — that's the step's contract. If you tried
   to connect two converters in a row, Mill would refuse and tell you
   why.
4. Add **Write text to clipboard**, then **Notify me**. Connect them
   in order.
5. Name the workflow and **Save workflow**.
6. Copy some page content, then **Run**. The notification tells you
   the Markdown is ready.

## Where to go next

- Give it a **hotkey**: change the trigger's type to Hotkey pressed in
  the step inspector, record a combo, and run it from any app.
- See what happened: every run is recorded under the workflow's
  **Runs** tab, step by step.
- Try a step with an external effect (like Call an API) and watch Mill
  park the run for your approval — that's the guardrail model,
  explained in [Guardrails](../concepts/guardrails.md).
