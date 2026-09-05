# Atlas

Drop a folder of markdown files onto the board and every file becomes a
card — edit one outside Mill and the card updates itself, no re-import.
That's Atlas: one zoomable map of cards, typed by kinds you define,
connected by links, grouped into areas you can drill into.

## The board's building blocks

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
  another one. A `.xml` file that holds a draw.io diagram (an
  exported one, say) lands as a diagram too — Mill reads the file to
  tell it apart from ordinary XML. Click anywhere on a diagram to select it and get its
  resize handles. A multi-page draw.io file shows page arrows when you
  hover it, so you can flip through its pages right on the board.
  General and flowchart shapes render with their real
  outlines; less common shape libraries still show as plain boxes.
  Drop an `.xlsx` or `.csv` file and it shows a preview of its first
  sheet, updating automatically whenever the file changes. For a CSV,
  double-click a cell to change it right on the board — Enter saves to
  the file, Escape cancels. Excel files stay read-only here — open
  them in your spreadsheet app to edit.
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
  fades on every line except the one you're editing; select some
  text and a small toolbar floats beside it with bold, italic,
  strikethrough, and code; type `[]` or `[x]` at the start of a line
  for a to-do, and Enter continues the list unchecked; at rest the
  note shows the rendered result, and clicking it brings the source
  back. With Rich code blocks turned on (Extensions →
  Note), press Shift-Option-F inside a code block to format it —
  JSON, JavaScript, TypeScript, CSS, HTML, YAML, and Markdown. A long sticky note scrolls in place, and grows while you
  edit it — and any note opens big: ⌘-click it (or right-click →
  Open note) for a full-size editor, like opening a note in its own
  window. Notes save when you click away; with Settings → General →
  Save changes set to "When I choose", they wait for ⌘S instead and
  show a dot until then.

## Contents

Everything on the board, listed by kind: cards, notes by their first
line, and every other object. Open it from the toolbar's list button
or the command palette ("Contents"), type to filter by name, and
activate a row to jump there — a card opens, a note or object is
brought into view.

## Drawing and images

- **Images and ink live on the board, not inside a card.** Take a
  screenshot to the clipboard and press ⌘V on the board — the image
  lands at your pointer, at its own size. Drag the little screenshot
  preview straight onto the board and it lands the same way, and so
  does an image dragged out of a browser page. Copy a file in Finder
  and paste it, and it lands exactly the way dropping it would: an
  image as an image, a diagram as a diagram, a document as a card.
  The Image button in the toolbar offers a file picker and a paste
  zone too, and pasting an image file's path as text also works.
  Dropping an image file onto the board does the same. Pick Pencil and drag to draw; lift and draw
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
  and stroke size, since a stroke has no separate fill. A diagram's own
  colours and styling stay whatever its own file sets, not this panel.
- **Turn a rectangle or ellipse with the rotate handle.** Select one
  and a small circular grip appears above it — drag to turn the shape
  live, holding Shift to snap every 15 degrees. Press Escape mid-drag
  to cancel back to where it was. The handle only shows on a single
  selected shape, and an arrow doesn't get one since its own shape
  already comes from the direction it points.

## Copy, paste, and create

- **Copy and paste to duplicate.** Select cards or notes and press
  ⌘C, then ⌘V — copies appear where your cursor is, filed into
  whatever area it's over. A copy is just the card itself; when the
  original has items inside, the paste offers to copy those too.
  Links come along only when both ends were copied. The copy is
  ordinary text on your clipboard, so it pastes across spaces.
- **Paste anything from outside Mill — it lands as the right kind of
  thing.** A table copied from a spreadsheet or a document app becomes
  a table on the board, ready to browse and edit like any other list.
  A pasted file path lands what dropping the file would: a document
  becomes a card, a diagram, spreadsheet, or PDF file its own board
  object (a PDF shows its pages right on the board — click it once to
  select it, then search, zoom, and page through it in place; while
  you scroll inside it the board holds still),
  a folder path opens the folder import. Everything else lands as a
  sticky note at your pointer, already selected — nothing else to
  fill in. Multiple tables in one paste each land as their own table,
  offset so you can tell them apart.
- **Create by pointing.** Press C (or pick Card in the toolbar) and
  click — the card appears right there and you name it in place;
  Enter keeps the name, Escape keeps it as Untitled. Web addresses
  on a card are real links — click one to open it in your browser.

## Finding what you need

- **Jump anywhere with ⌘K.** Type a few letters and pick from every
  card and every placed object — a diagram, an image, a table —
  matched by its name. Enter flies the board to it and pulses it so
  your eye lands in the right place, even when it lives levels away.
- **Tidy the whole board with Auto-arrange.** One click packs
  everything on the current level — cards and objects alike — into
  clean rows, then leaves you in control: anything you drag
  afterwards stays where you put it.
- **Group anything into an area.** Select any two or more things —
  cards, notes, diagrams, images — and press G (or draw an area
  around them) to file them into a named area together. The area
  shows a small preview of everything inside, objects included, and
  its count includes every member.
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
  own colour, stroke, and rotation come along; a freeform arrow, a
  sketch, or an image doesn't have a faithful box to become yet, so
  it's named rather than silently left out.
- **Take a picture of what you're looking at.** Right-click a
  selection, or open the Atlas menu, for "Copy as image" and "Export as
  image…". Copy puts a sharp PNG straight on your clipboard, ready to
  paste into a document, a deck, or a chat. Export opens a small dialog
  where you pick the scale and whether the background comes along, then
  saves the file. Both picture whatever is selected; with nothing
  selected, both widen to the whole board. Selection outlines, drag
  handles and resize frames never appear in the picture. Working in a
  browser against a Mill running elsewhere, the copy lands on that
  machine's clipboard, and the confirmation says so.

## Keeping Atlas in sync

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

## Cards that act, and undo

- **Cards can act.** A card can carry attached action workflows —
  run them from the card. Workflows can also read and write cards as
  steps (create, update, find, link), and a trigger can fire on card
  changes — the board and the automation layer are one system.
- **Undo almost anything.** ⌘Z undoes your last change on the
  board — drawing a stroke, moving or resizing a card, deleting
  something, pasting a table — and ⇧⌘Z brings it back. Deleting
  also shows a brief Undo button; either one restores it. A change
  someone else makes at the same time is never something your own
  ⌘Z can undo.

## Tables and the AI companion

- **Tables are projections.** Start one from nothing with "New
  table" (the toolbar at the bottom of the board, next to Card,
  Note, and Area): sweep the size grid to the shape you want, then
  move the pointer over the board — a dashed outline carrying the
  new table's name follows it, so you see where the table lands
  before you commit. Click to place it there (inside an area if
  that's where you point), backing List and name together. Escape
  cancels an armed size. Or pick "Table from a List" to project a
  List you already have. Either way the List stays the single source
  of truth, so the table is never stale and every board showing it
  agrees.
- **Name a table on the board.** Every table carries its name in a
  row above its grid. Double-click the name to rename it in place,
  or right-click the table and pick Rename. Enter keeps the new
  name, Escape leaves the old one, and a blank name changes nothing.
  The name belongs to the backing List, so it changes everywhere
  that List is shown.
- **Click once to pick a table up, again to edit it.** The first
  click on a table selects the whole object: drag its band to move
  it, drag a corner while it is selected to give it more room — the
  size sticks. Once it is selected, clicks reach the cells: click a
  cell to change it, click a column header to rename it, and hover a
  header or row for the ⊕ that inserts a column or row exactly
  there. Escape leaves the grid with the table still selected, so
  Delete removes the whole table. Workflows write the same List
  through their own guarded steps.
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

## Other views

Matrix and Coverage views project the same data as grids when a board
is the wrong shape for the question. Roadmap lays a space's cards out
as swimlanes — one row per card type, one column per Now/Next/Then
tag plus an Unscheduled column for anything untagged — so you can see
at a glance what's planned and what still needs a tag. An empty
roadmap still shows the full column layout, and each Now/Next/Then
column has its own "Place cards" button that opens a picker of the
space's other cards — pick one and it lands in that column, and if
its type doesn't have a Horizon field yet, Mill adds one automatically
and says so with a quiet toast. Drag a card's chip between columns to
retag it, or onto Unscheduled to clear the tag.
