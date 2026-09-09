---
kind: explanation
---

# Selecting and bulk actions

Every list in Mill — Configure's entities, Workflows, Secrets — shares
one way to work on several rows at once, the same shape any email
inbox or file browser's own multi-select already uses.

## Turning a row into a selection

Hover a row and a checkbox appears at its start; click it to select
that row without opening it. Shift-click a row to select every row
between it and the last one you touched. ⌘/Ctrl-click a row toggles it
in or out without opening it either. A plain click, with no modifier,
still opens the row — selecting never gets in the way of browsing.

On a phone or a narrow window, press and hold a row instead: holding it
still for about half a second selects it, the same way a touch list
elsewhere on your phone works.

## The selection bar

Selecting anything replaces the toolbar with a bar naming how many rows
are selected, the actions available for them, and a way to cancel.
Selecting more rows updates the count live; when only some of the rows
on screen are selected, the bar offers to select every row currently
matching your search and filters, not just the visible page.

Press Escape, or the bar's close button, to clear the selection and
bring the toolbar back.

## Keyboard

With a list in view, ⌘A (Ctrl+A on Windows/Linux) selects every row
currently shown; Escape clears the selection; Delete removes it.

## Deleting several at once

Delete acts on every selected row, even when one of them turns out to
be in use elsewhere and can't be removed — Mill deletes everything it
can and names whichever rows it kept, rather than stopping at the
first one it can't touch. Where the delete can be undone, one Undo (the
toast's button, or ⌘Z) brings every deleted row back at once, not one
at a time.
