# Board Audit

Summarizes the current board's cards, notes, other objects, and links.
It also reports any link whose source or target is no longer present.
The same read-only action is available from the command palette and as
an agent tool.

## Settings

None.

## Capabilities

None. The plugin reads through Mill's built-in `query` and `links`
doors.

## Try it

Copy the `board-audit` folder into Mill's plugins folder (Settings > Extensions >
Open plugins folder) and reload plugins.
Run **Audit this board** from the command palette. Mill shows the
summary as a notice; a missing endpoint changes the notice to a
warning.
