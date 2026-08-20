# Atlas

Atlas is Mill's knowledge board: one zoomable map of cards, typed by
kinds you define, connected by links, grouped into areas you can drill
into.

- **Cards** carry a kind (Topic, Contact, Document — or your own,
  authored with typed fields), a title, notes, and typed field
  values. Drop a markdown file on the board and it lands as a card
  mirroring the file; mirrored markdown renders in the card —
  including ` ```mermaid ` fences as live diagrams.
- **Links** connect cards through link kinds you define. Drag from a
  card's link handle and release anywhere on a highlighted card; one
  relationship per pair and kind — repeats never duplicate. Hover a
  link for its actions.
- **Areas** group cards; drill in to work at a level, breadcrumb back
  out. Perspectives save named views of the map.
- **Filter without losing the map.** The search control on the board
  (top right) dims everything that doesn't match your text or chosen
  kinds — matches stay crisp in place, so you keep the spatial
  context instead of watching cards vanish. Filters are a question,
  not a setting: they clear with one click and are never saved.
- **Sync a docs folder**: the seeded "Mirror a docs folder into
  Atlas" workflow regenerates a space from a folder of markdown,
  idempotently — a maintained docs set becomes a maintained map.
- **Cards can act.** A card can carry attached action workflows —
  run them from the card. Workflows can also read and write cards as
  steps (create, update, find, link), and a trigger can fire on card
  changes — the board and the automation layer are one system.
- **Tables are projections.** "Table from a List" (the board's + Add
  menu) drops a card that shows a Configure List live — the List
  stays the single source of truth, so the table is never stale and
  every board showing it agrees. Edit right on the table: click a
  cell to change it, click a column header to rename it, and hover a
  header or row for the ⊕ that inserts a column or row exactly
  there. Workflows write the same List through their own guarded
  steps.
- **Recognized sources.** A card whose Source URL matches one of your
  configured integrations shows that integration's name beside the
  link, and any workflow declaring "Offer on cards from" that
  integration appears on the card as a ready action — running it
  attaches it. Every action run receives the card's Source URL and
  field values, so a "refresh this page" workflow knows its target.

Matrix and Coverage views project the same data as grids when a board
is the wrong shape for the question.
