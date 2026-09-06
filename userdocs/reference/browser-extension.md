---
kind: reference
---

# The browser extension

Some work only exists behind a sign-in. Mill can replay a recorded set
of steps in **your** browser, in the session you are already signed into,
so nothing has to be re-authenticated and no password ever reaches Mill.

The browser half of that is a small extension, which ships inside Mill
itself.

## Install it

1. Open **Settings › Connections › Browsers** and press **Reveal the
   extension folder**. Mill writes the extension out and shows you where
   it landed.
2. Open your browser's extensions page (`chrome://extensions` in Chrome)
   and turn on **Developer mode**.
3. Choose **Load unpacked** and pick the folder Mill just showed you.
4. Pin the Mill icon so its popup is one click away.

Chrome, Edge and Opera all load the folder as-is. Mill rewrites the
folder every time you reveal it, so after an upgrade, reveal it again
and reload the extension.

## Pair it

A browser has to be paired before Mill will send it anything, and that
holds even when both are on the same computer. Anything running locally
could otherwise drive your tabs.

1. Open **Settings › Connections › Browsers**. Note the **Mill address**
   shown there.
2. Press **Pair a browser**. An eight-character code appears, good for
   five minutes and usable once.
3. Open the extension's popup, check the address matches, type the code,
   and press **Pair**.
4. The popup shows **Connected to Mill**, and the browser appears in the
   Browsers list.

## Test it

Press **Test the connection**. Mill opens a page it serves itself,
presses a button on it, and waits for what the press reveals — the three
things every recorded flow depends on. It then reports how many steps
ran and how long they took.

If nothing is listening, Mill says so rather than waiting: *No browser is
connected. Pair the Mill extension first.*

## Record the steps

Mill replays Chrome DevTools Recorder flows exactly as exported:

1. Open DevTools and go to the **Recorder** panel.
2. Record what you do on the page.
3. Export the recording as JSON.

Every selector the Recorder writes is honoured, including its fallback
chains — a CSS selector, an accessible name, the visible text, an XPath,
and a path through a component's shadow root. That redundancy is what
lets a recording survive a page whose styling changed underneath it.

## Replay a recording as a workflow step

**Replay in the browser** is a step like any other. Add it to a
workflow, and it runs your recording in the paired browser as part of a
run.

- **Recording** — press **Import a recording** and pick the JSON you
  exported. The file is stored exactly as exported; nothing rewrites it.
- **Parameters** — a run rarely wants the same text every time. Each
  parameter names one step of the recording, one of its fields (the
  address it opens, the text it types, the key it presses), and where
  the value comes from: one of the workflow's Attributes, or a fixed
  value. The values are laid over a copy of the recording at run time.
- **Extract** — name a step that waits for an element, and the text of
  that element comes back under the name you gave it.
- **Timeout** — how long the whole flow may take before the run fails.

The step leaves a result you can read in the run's receipt: every step
with its outcome, the text you extracted, and any file the browser
saved while the flow ran.

Driving a live site is an external effect, so a run parks for your
approval before the browser is touched, the same as an outgoing HTTP
call.

### When it stops

- *No browser is connected. Pair the Mill extension first.* — nothing is
  listening; pair a browser.
- *Couldn't find the element for step 3 (#email).* — the page changed
  under the recording. Re-record that step.
- *The browser didn't finish the flow in 60 seconds.* — the flow is
  longer than its budget, or the page is waiting on something. Raise the
  timeout, or shorten the flow.
- *Parameter email points at step 4, which has no value.* — the
  parameter names a step that types nothing. Point it at the step that
  does.

## What it can and cannot do

It can open a tab or reuse one already on the right site, click,
double-click, hover, type into fields, press keys, scroll, wait for an
element or for an expression to become true, and report a file the page
downloaded while the steps ran.

It cannot resize your window, shape your network, or close tabs. Those
steps are reported as skipped rather than performed.

## Revoke it

A paired browser stays paired until you revoke it. Press **Revoke** on
its row in **Settings › Connections › Browsers**. The connection ends
immediately, including in the middle of a run.

## What leaves your machine

Nothing. The extension talks only to the Mill address you entered, which
is your own computer by default. The pairing token is held by the
browser for this extension alone, and Mill keeps only a hash of it.
