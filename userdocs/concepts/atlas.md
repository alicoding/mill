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
  live diagrams.
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
- **Copy and paste to duplicate.** Select cards or notes and press
  ⌘C, then ⌘V — copies appear where your cursor is, filed into
  whatever area it's over. A copy is just the card itself; when the
  original has items inside, the paste offers to copy those too.
  Links come along only when both ends were copied. The copy is
  ordinary text on your clipboard, so it pastes across spaces.
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
  — your sign-off, verified date, and notes always stay put.
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
is the wrong shape for the question.
