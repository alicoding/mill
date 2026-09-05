# The Mill browser extension

Mill can replay a recorded flow in **your** browser, in the session you
are already signed into. This extension is the browser half of that:
Mill sends the steps, the extension performs them in a tab, and reports
each step back.

## Install it

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and pick this folder.
3. Pin the Mill icon so the popup is one click away.

Chrome, Edge and Opera all load this folder as-is.

## Pair it with Mill

1. In Mill, open **Settings › Connections › Browsers** and press
   **Pair a browser**. A code appears, good for five minutes.
2. Open the extension's popup. Check that **Mill address** matches the
   address Mill shows in that same section, type the code, and press
   **Pair**.
3. The popup says **Connected to Mill**. Back in Mill, press **Test the
   connection** — a tab opens, a button is pressed, and Mill reports how
   many steps ran.

Pairing lasts until you revoke it. Revoking the browser in Mill ends the
connection immediately, mid-run included.

## Record a flow

Mill replays Chrome DevTools Recorder flows unchanged:

1. Open DevTools, go to the **Recorder** panel, and record what you do.
2. Export the recording as JSON.
3. Hand that JSON to Mill.

Every step type and every selector the Recorder writes is understood as
recorded — including its selector fallback chains, which is what lets a
flow survive a page whose CSS classes changed.

## What it can and cannot do

It can open and reuse tabs, click, double-click, hover, type into
fields, press keys, scroll, wait for an element or for an expression to
become true, and report a file the page downloaded during the run.

It cannot resize your window, shape your network, or close tabs on
Mill's behalf — those steps are reported as skipped rather than
performed. It also does nothing at all until a flow arrives from a Mill
you have paired it with.

## Why it asks for access to every site

Replay has to reach whatever site you recorded against, and that site is
not known until a flow arrives. There is no narrower permission that
still lets a recording of your own work replay. The extension holds one
connection, to the Mill address you entered, and reads nothing from a
page except what the step it is running asks for.

Your pairing token is stored by the browser for this extension only. It
is sent to your Mill and nowhere else.
