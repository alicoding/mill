# Configure entities

Two workflows call the same API. Point both at one Integration entry
instead of pasting the base URL and auth into each step, and changing
the endpoint later is a single edit that both workflows pick up.

Configure holds the things workflows and boards *point at* — the
values two independently-authored workflows should share, where
drifting apart would be a bug. Deleting any of them takes effect at
once and offers Undo for ten seconds; an entry a workflow still uses
refuses to delete and names the workflow. An undone Integration comes
back without its secret — enter it again.

The entities:

- **Integration** — an HTTP API: base URL, auth (the secret lives in
  your OS keychain, never in config), operations with typed inputs
  and outputs. Choosing an auth type shows only that type's fields;
  encrypting the request body (JWE) and a fixed fallback body sit
  under Advanced. Test a saved integration from its own Testing tab.
- **Lists** — typed tabular data steps can look up, search, and
  write; Atlas can project them too. A list edits as one spreadsheet-
  style grid: click a cell to select it, click again (or press
  Enter, or just type) to edit it; Tab commits and moves right, Enter
  commits and moves down, Escape cancels. Select a range and copy or
  paste it, drag the fill handle to repeat a value, press Delete to
  clear. Drag a header's edge to resize a column, drag the header to
  reorder. The header's menu (or a right-click on it) renames the
  column, inserts one to either side, and opens its type, choices,
  deprecation, and removal; a right-click on a row inserts a row
  below it, marks it expired or active, or deletes it. A column's type
  can change until it holds data. Commits happen as you go. Bring data in from a CSV or JSON file: "Import rows…" on a
  list maps file columns to its fields, and "New from file…" on the
  Lists page proposes a whole typed schema from your sample — edit
  the proposed names and types, then create the list with every row
  in one step. A list can also mirror an outside source, one way: the
  "Sync rows into a list" step turns a request's JSON result into rows
  matched by a key column, on whatever schedule its workflow runs —
  "Example: Jira issues → List" shows the shape, and Mill never writes
  back to the source. Deleting a list is immediate and permanent, so
  export first if you might want it back.
- **MCP Servers** — other MCP servers Mill can call as workflow
  steps. (Connecting an agent *to* Mill is the other direction — see
  Settings → MCP access.)
- **AI Providers** — a local or remote model endpoint the AI steps
  resolve by reference.
- **Execution environments** — a pinned shell, directory, and
  environment for Run a command. This is reproducibility, not a
  sandbox: the script runs with your full user account. Clean profile
  mode sources no shell startup files, so a step sees only the
  variables you declare; Login mode sources your shell's login files
  as well. A step's own Working directory field overrides the
  environment's directory for that run, with a value from a captured
  Attribute.
- **Conversion profiles** — which source-specific rules an HTML to
  Markdown conversion applies (Confluence, Office and Word). The
  converter step picks one; leave it empty and every rule applies.
  The page's sample preview shows what each profile makes of a paste.
- **Attributes** — a workflow's declared typed fields.
- **Decisions** — named outcome sets a workflow records against,
  with published versions.
- **Step types** — your own palette entries: a named, curated binding
  over an existing engine (an API operation, an MCP tool, a callable
  workflow) with the sharp edges pinned away.

The dividing rule: a value that names **which external thing** to
talk to is a Configure entity, picked by reference in the step. A
value that is one workflow's **own decision** — a threshold, a
category list, literal text — stays in the step where you see it.

Everything here rides Settings → Backups' snapshot, export, and
import — except secrets, which stay in the keychain and are
deliberately never exported.
