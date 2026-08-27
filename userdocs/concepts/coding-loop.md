# The coding loop

Copy a shell command, hit the hotkey, and Mill shows you exactly what
it parsed before anything runs.

## Copy a command, hit the hotkey

Say a tool hands you a command to debug something — a `curl` to test
a connection, a couple of setup lines to try. Copy it, then run
**Run from clipboard…** from the command palette (⌘K) or Quick
Panel — the same panel a global hotkey opens from any app, so this
works even when Mill isn't in front.

## Confirm before anything runs

Mill parses the copied block into its real structure first:

- A **piped command** (`a | b`) stays one step.
- Commands on separate **lines** each show as their own step, and
  run regardless of what came before.
- Commands joined by **`&&`** also show as separate steps, but a
  later one is skipped if an earlier one fails — matching what `&&`
  already means.

The confirm screen shows every step, the shell and folder it'll run
in, and whether a step needs your approval. A step that looks like
it has a placeholder for a secret — `<YOUR_TOKEN>` and similar — is
flagged so you know it'll run exactly as copied, nothing filled in
for you. Nothing runs until you click **Run**.

## Watch it run

Once you confirm, each step shows live: waiting, running, done,
failed, or skipped, with the running step's own output as it
happens. If a step goes quiet, Mill tells you it's stuck instead of
leaving you guessing. Cancel stops it from there.

Closing the window doesn't stop the run — it keeps going, and you
can find it again in **Activity**.

## Copy the result back

When it finishes, every step's output is right there, with **Copy
result** ready for pasting back into wherever the command came from.
The run itself is saved too, so you can find it again later.
