---
kind: reference
---

# The browser extension

Some work only exists behind a sign-in. Mill can replay a recorded set
of steps in **your** browser, in the session you are already signed into,
so nothing has to be re-authenticated and no password ever reaches Mill.

The browser half of that is a small extension. Mill ships it in the
`examples/browser-extension` folder of its own source tree.

## Install it

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and pick the `examples/browser-extension`
   folder.
3. Pin the Mill icon so its popup is one click away.

Chrome, Edge and Opera all load the folder as-is.

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
