# Configure entities

Configure holds the things workflows and boards *point at* — the
values two independently-authored workflows should share, where
drifting apart would be a bug:

- **Integration** — an HTTP API: base URL, auth (the secret lives in
  your OS keychain, never in config), operations with typed inputs
  and outputs.
- **Lists** — typed tabular data steps can look up, search, and
  write; Atlas can project them too. A list edits as one table:
  click a cell to change it, click a header to rename its column,
  hover a header or row for the ⊕ that inserts one exactly there,
  and open the header's gear for the column's type, choices, and
  removal. A column's type can change until it holds data. While
  editing a cell, Tab moves right, Enter moves down, Escape cancels
  — commits happen as you go.
- **MCP Servers** — other MCP servers Mill can call as workflow
  steps. (Connecting an agent *to* Mill is the other direction — see
  Settings → MCP access.)
- **AI Providers** — a local or remote model endpoint the AI steps
  resolve by reference.
- **Execution environments** — a pinned shell, directory, and
  environment for Run a command. This is reproducibility, not a
  sandbox: the script runs with your full user account.
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
