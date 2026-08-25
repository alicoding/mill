# Atlas

Atlas is Mill's knowledge board: one zoomable map of cards, typed by
kinds you define, connected by links, grouped into areas you can drill
into.

- **Cards** carry a kind (Topic, Contact, Document — or your own,
  authored with typed fields), a title, notes, and typed field
  values. Mark a field "Show on card" in the kind editor and its
  value appears right on the card's face — choice fields as their
  colored pills, the way the seeded Topic shows its status. A field
  can also reference another card of a kind you pick: the page
  offers only matching cards, and a set reference draws a dashed,
  labeled line between the two on the board. Drop a markdown file on
  the board and it lands as a card mirroring the file; mirrored
  markdown renders in the card — including ` ```mermaid ` fences as
  live diagrams. Drop a `.drawio` or `.mmd` file and it renders the
  same way, updating automatically whenever you edit that file outside
  Mill — a missing file shows a clear notice with a button to choose
  another one. General and flowchart shapes render with their real
  outlines; less common shape libraries still show as plain boxes.
- **Links** connect cards through link kinds you define. Drag from a
  card's link handle and release anywhere on a highlighted card; one
  relationship per pair and kind — repeats never duplicate. Hover a
  link for its actions.
- **Areas** group cards; drill in to work at a level, breadcrumb back
  out. Drag a card onto an area to file it; drag it back out — from
  the area's preview or from inside — and it moves up a level, or
  into whichever area you drop it on. Perspectives save named views
  of the map.
- **Notes are markdown.** Write headings, lists, bold, tables — in
  a card's note or a board sticky note (press N and click). While
  you type, formatting appears in place and the markdown syntax
  fades on every line except the one you're editing; at rest the
  note shows the rendered result, and clicking it brings the source
  back. A long sticky note scrolls in place, and grows while you
  edit it — and any note opens big: ⌘-click it (or right-click →
  Open note) for a full-size editor, like opening a note in its own
  window.
- **Images and ink live on the board, not inside a card.** Pick Image
  in the toolbar, choose a file, or paste a screenshot — it lands at
  its own size, right where you put it. Dropping an image file onto
  the board does the same. Pick Pencil and drag to draw; lift and draw
  again for the next stroke, no interruption. Either one is a thing in
  space you can move, select, and delete, and ink stays visually on
  top of an image so you can mark one up. Nothing becomes a card until
  you ask: right-click either one and choose "Promote to card…" to
  give it a title and a kind. The pointer always shows which tool is
  armed, over anything on the board. Hold Space to pan the board
  without drawing, and press Escape to put a drawing tool away.
- **Shapes have their own style options.** Pick Shape in the toolbar
  and drag to draw a rectangle, ellipse, or arrow; while it's armed, a
  small panel above the button offers the shape type, stroke colour,
  stroke width, and fill. Fill starts off (an outline only) — pick a
  colour to fill the interior instead, and a filled shape is still
  fully clickable anywhere inside it, not just along its outline. Each
  drawing tool's panel offers only the style controls that make sense
  for it, drawn from the same small set: a colour, a colour that can
  also be switched off, a numeric width shown as a line or a dot, or a
  named shape choice. Pencil's panel, for example, offers only colour
  and stroke size, since a stroke has no separate fill. This is also
  why fill was the first new option to land on shapes — it reuses the
  "colour, switchable off" control every future style option of that
  same kind gets for free. A diagram's own colours and styling stay
  whatever its own file sets, not this panel.
- **Copy and paste to duplicate.** Select cards or notes and press
  ⌘C, then ⌘V — copies appear where your cursor is, filed into
  whatever area it's over. A copy is just the card itself; when the
  original has items inside, the paste offers to copy those too.
  Links come along only when both ends were copied. The copy is
  ordinary text on your clipboard, so it pastes across spaces.
- **Paste anything from outside Mill — it lands as the right kind of
  thing.** A table copied from a spreadsheet or a document app becomes
  a table on the board, ready to browse and edit like any other list.
  Everything else lands as a sticky note at your pointer, already
  selected — nothing else to fill in. Multiple tables in one paste each
  land as their own table, offset so you can tell them apart.
- **Create by pointing.** Press C (or pick Card in the toolbar) and
  click — the card appears right there and you name it in place;
  Enter keeps the name, Escape keeps it as Untitled. Web addresses
  on a card are real links — click one to open it in your browser.
- **Filter without losing the map.** The search control on the board
  (top right) dims everything that doesn't match your text, chosen
  kinds, or field values (the Fields menu lists every choice-type
  field on the board — pick "Status: Open" to light up just those
  cards) — matches stay crisp in place, so you keep the spatial
  context instead of watching cards vanish. Filters are a question,
  not a setting: they clear with one click and are never saved.
- **Export takes the shape you need.** The toolbar's Export control
  offers a choice: the whole map as portable JSON, ready to import
  into another Mill, or just the board you're viewing as a `.drawio`
  file. Cards become boxes, links become labelled connections, and
  areas nest exactly the way they do on the board — open the download
  in draw.io or hand it to a tool that expects that format. A shape's
  own colour and stroke come along; a freeform arrow, a sketch, or an
  image doesn't have a faithful box to become yet, so it's named
  rather than silently left out.
- **Sync a docs folder**: the seeded "Mirror a docs folder into
  Atlas" workflow regenerates a space from a folder of markdown,
  idempotently — a maintained docs set becomes a maintained map.
- **Track delivered work with evidence.** Point the seeded "Example:
  Delivery ledger" workflow's folder path at a folder of goal files
  with a frontmatter header (`id`, `status`, `date`, `prs`, `proof`,
  `spec_refs`) and run it — each file becomes a Delivered feature
  card carrying its goal, shipped date, PRs, and proof. Set Sign-off
  to Verified or Verified with notes once you've checked the
  evidence; Mill stamps the verified date for you. Re-running the
  workflow after a file changes updates only the goal/date/PRs/proof
  — your sign-off, verified date, and notes always stay put. The area
  you file them under shows how many are signed off, right on its own
  face — "12 of 40 done," alongside the card count.
- **Cards can act.** A card can carry attached action workflows —
  run them from the card. Workflows can also read and write cards as
  steps (create, update, find, link), and a trigger can fire on card
  changes — the board and the automation layer are one system.
- **Tables are projections.** Start one from nothing with "New
  table" (the toolbar at the bottom of the board, next to Card,
  Note, and Area): sweep the size grid to the shape
  you want, then click the spot on the board where it should live —
  the table lands right there (inside an area if that's where you
  point), backing List and card together, ready to rename columns
  in place. Escape cancels an armed size. Or pick "Table
  from a List" to project a List you already have.
  Either way the List stays the single source of truth, so the table
  is never stale and every board showing it agrees. Edit right on
  the table: click a cell to change it, click a column header to
  rename it, and hover a header or row for the ⊕ that inserts a
  column or row exactly there. Drag the card's corner while it's
  selected to give a table more room — the size sticks. Workflows
  write the same List through their own guarded steps.
- **Ask the AI companion.** Click the sparkle icon in the toolbar to
  open a chat panel beside the board. Pick a configured AI provider,
  then ask about or describe what you want organized — the reply
  streams in, and when it proposes cards or a scratchpad note you
  review and accept before anything is created; collisions with
  existing cards start unchecked so nothing gets overwritten. Keep
  talking to refine a proposal instead of accepting it. Closing the
  panel clears the conversation.
- **Recognized sources.** A card whose Source URL matches one of your
  configured integrations shows that integration's name beside the
  link, and any workflow declaring "Offer on cards from" that
  integration appears on the card as a ready action — running it
  attaches it. Every action run receives the card's Source URL and
  field values, so a "refresh this page" workflow knows its target.

Matrix and Coverage views project the same data as grids when a board
is the wrong shape for the question. Roadmap lays a space's cards out
as swimlanes — one row per card type, one column per Now/Next/Then
tag plus an Unscheduled column for anything untagged — so you can see
at a glance what's planned and what still needs a tag. Tag a card by
adding a Horizon field to its type in Kinds, then setting Now, Next,
or Then on the card itself; it's view-only today, so moving a card
between columns still means editing that field.
