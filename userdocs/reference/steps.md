# Step reference

Generated from the live step registry — every step's contract exactly as the canvas enforces it. Do not edit by hand; `go generate ./internal/docsgen` regenerates.

## Triggers

### Atlas card changed

Fires when a card of the chosen kind is created or updated in Atlas. A run started by this trigger never re-fires itself from a write it makes to its own source card, so a workflow that both reacts to and updates a card can't loop.

- Takes: nothing — Produces: text
- Effect: none — pure computation
- Settings:
  - **Kind** — Which Atlas card kind to watch. Fires only for cards of this kind.

### Called by another workflow

Fires only when another workflow invokes this one with its Child Workflow step, never by an outside event. A workflow starting here declares itself callable: it appears in the Child Workflow step's picker and nowhere else.

- Takes: nothing — Produces: anything
- Effect: none — pure computation

### Clipboard captured

Fires when you copy something new. It skips content marked confidential by the app you copied it from, and skips text Mill itself just wrote back to the clipboard.

- Takes: nothing — Produces: text
- Effect: none — pure computation

### Clipboard changed

Fires whenever the clipboard's content changes.

- Takes: nothing — Produces: text
- Effect: none — pure computation

### File changed

Fires when a file or folder under the configured path is added, changed, or deleted.

- Takes: nothing — Produces: text
- Effect: none — pure computation
- Settings:
  - **Path to watch** — Absolute path to a file or directory.
  - **Filename pattern (optional)** — A glob like *.md or report-*.csv. Only files whose name matches fire the trigger. Leave empty to fire on any change.

### Hotkey pressed

Fires on a global keyboard shortcut, even when Mill isn't focused. Bound via TriggerService, not a config field here.

- Takes: nothing — Produces: an empty start
- Effect: none — pure computation

### Manual run

Fires on-demand when a user clicks Run/Test. No listener process.

- Takes: nothing — Produces: an empty start
- Effect: none — pure computation

### On a schedule

Fires on a cron schedule.

- Takes: nothing — Produces: an empty start
- Effect: none — pure computation
- Settings:
  - **Cron expression** — Standard 5-field cron expression (minute hour day month weekday).

### System event

Fires when Mill's own engine emits an internal event (a run finishing, failing, or parking for approval), so a workflow can react to the platform itself, like forwarding pending approvals to another device.

- Takes: nothing — Produces: JSON
- Effect: none — pure computation
- Settings:
  - **Event** — Which internal event fires this trigger. "Decision parked" fires when a guardrail ask or human-review checkpoint parks awaiting approval; the run events fire once a run reaches a terminal state; "update-available" fires when an update check finds a newer release on this install's channel.
  - **Workflow scope** — Fire for every workflow's matching event, or scope to one specific workflow. Empty means all workflows.

## Capture

### Inspect clipboard

Reads the clipboard's own format report, listing which flavors (HTML, plain text, images) are present and their sizes, and summarizes whether HTML and plain text are available, followed by the raw report. A diagnostic for pastes that look right but convert wrong: see directly whether HTML was actually on the clipboard.

- Takes: nothing — Produces: text
- Effect: reads local state

### Read attribute

Replaces the payload with the value of one of this workflow's declared Attributes, e.g. a callable workflow's typed input, or a value a Decision already routed on.

- Takes: nothing — Produces: text
- Effect: none — pure computation
- Settings:
  - **Attribute** — The declared Attribute key to read (Configure > Attributes, or the typed input a calling workflow bound).

### Read clipboard

Reads the clipboard's HTML. If there's no HTML flavor (many apps only put plain text), falls back to the plain-text flavor rather than failing.

- Takes: nothing — Produces: HTML
- Effect: reads local state

### Read clipboard text

Reads the clipboard's plain text only, never its HTML. Use it for ids, tokens, and anything copied as-is.

- Takes: nothing — Produces: text
- Effect: reads local state

### Read file

Reads a local file into the payload. "payload" source treats the current payload as the file path, which a File changed trigger supplies; "literal" reads a fixed path instead.

- Takes: text (optional) — Produces: anything
- Effect: reads local state
- Settings:
  - **Path source** — "payload" reads the path from the upstream payload (a filesystem-watch trigger's changed path); "literal" reads the fixed path below instead.
  - **Path** — The file path to read when "Path source" is literal. Ignored when source is payload.

## Process

### Add text

Prepends or appends configured static text to the payload, e.g. a fixed hint or instruction pasted alongside a workflow's real output.

- Takes: text (optional) — Produces: text
- Effect: none — pure computation
- Settings:
  - **Text to inject** — The literal text this step adds to the payload. Left empty, this step is a no-op.
  - **Placement** — Where the text goes relative to the existing payload.

### Ask for review

Pauses the run for a person: the item lands in the Review queue (and this workflow's Runs tab), where a reviewer can approve, deny, and fill in values for this workflow's declared Attributes. Their input flows into the resumed run. Denying (or 24 hours of silence) stops the run. A deliberate, visible checkpoint you drew into the flow: the ambient guardrail rules (Configure > Guardrails) never skip it.

- Takes: anything — Produces: its input, unchanged
- Effect: none — pure computation
- Settings:
  - **Message to the approver** — Shown alongside the approval request, so future-you knows what this checkpoint is guarding.
  - **Ask for these attributes** — Comma-separated Attribute keys the reviewer should fill in. Leave empty to ask for all of the workflow's Attributes.

### Call an API

Calls a Configure-authored integration's API and replaces the payload with the response body. The step only picks WHICH integration and binds data. Method, endpoint path, and body all live on the integration itself (Configure > Integration). Legacy steps saved with their own path/method/bodyTemplate config keep working (those keys still win when present); they're just no longer authorable here.

- Takes: anything — Produces: anything
- Effect: external — parks for approval by default
- Settings:
  - **Integration** — Which Configure-authored integration this step calls. (references an Integration)

### Call an MCP tool

Calls one tool on a configured MCP server and replaces the payload with its text result. The tool is picked from the server's live tool list, with typed-name fallback when the server can't be reached.

- Takes: anything — Produces: anything
- Effect: external — parks for approval by default
- Settings:
  - **MCP Server ID** — The ID of an MCP server configured on the Configure page. (references an MCP Server)
  - **Tool name** — The exact tool name, from that server's own tool list.
  - **Arguments (JSON)** — Optional JSON object of arguments to pass to the tool. Top-level string values of the form "attr:<name>" resolve to the named Attribute's typed value at run time (a number/boolean Attribute stays a JSON number/boolean, not stringified); every other value is sent as-is.

### Classify with AI

Sends the payload, plus an optional instruction, to a configured AI provider and asks it to pick exactly one of this step's declared categories, writing the choice into a named Attribute. Pairs with Branch to route on the result.

- Takes: text — Produces: its input, unchanged
- Effect: external — parks for approval by default
- Settings:
  - **AI provider** — Which Configure-authored AI provider (local Ollama or a BYO endpoint) this step calls.
  - **Instruction** — Optional guidance sent as the user message, followed by the current payload. Leave empty to classify the payload with no extra instruction.
  - **Categories** — One category per line. The AI picks exactly one of these.
  - **Write category to** — The declared Attribute key the chosen category is written into.

### Convert HTML to Markdown

Converts HTML into Markdown, preserving structure (headings, bold, lists).

- Takes: HTML — Produces: Markdown
- Effect: none — pure computation
- Settings:
  - **Conversion profile** — Which source-specific rules apply (Confluence, Office). Empty applies every rule set. (references a Conversion profile)

### Create run receipt

Renders this run's own recorded evidence (its steps so far, their guardrail verdicts, and which Mill build ran them) as a JSON receipt, replacing the payload. Only covers steps that ran BEFORE this one, since the run is still in flight when this step executes. Compose it with an Apply step (clipboard/file write) to hand the receipt to an external agent; there is no separate send path.

- Takes: nothing — Produces: JSON
- Effect: reads local state

### Extract HTML section

Extracts one element (by CSS selector) out of the payload's HTML, dropping everything else, e.g. a saved page's main-content region, stripping nav/header/footer chrome before converting to Markdown. Fails the step if nothing matches (fail-safe: never silently passes the whole, unfiltered document through).

- Takes: HTML — Produces: HTML
- Effect: none — pure computation
- Settings:
  - **CSS selector** — A CSS selector, optionally comma-separated (e.g. "#main-content, main, article"). The first matching element (in document order) is kept.

### Extract fields with AI

Sends a prompt plus the payload to a configured AI provider, requests a structured response, and writes each declared output field into this workflow's Attributes by the same key. Every declared field is required; one the provider omits is written empty rather than dropped.

- Takes: text — Produces: its input, unchanged
- Effect: external — parks for approval by default
- Settings:
  - **AI provider** — Which Configure-authored AI provider (local Ollama or a BYO endpoint) this step calls.
  - **Prompt** — The extraction instruction sent as the user message, followed by the current payload (if any).
  - **Output fields** — The typed fields this step extracts. Each becomes an Attribute of the same key, authored via the field editor below (not raw JSON).

### Find Atlas cards

Searches a Kind's cards in Atlas against one or more match parameters (exact or fuzzy, AND'd together) and writes the result into Attributes. Match against "title" or any of the Kind's own field keys.

- Takes: nothing — Produces: its input, unchanged
- Effect: reads local state
- Settings:
  - **Kind** — Which Atlas card kind to search.
  - **Match parameters** — JSON array of match criteria, ALL must match (AND): [{"column":"title","value":"attr:leadName","matchType":"exact"},{"column":"status","value":"New","matchType":"exact"}]. value is a literal or "attr:<name>".
  - **Stop at first match** — Stops scanning after the first match.
  - **Output attribute** — Which Attributes field receives the typed search-result object.

### Generate with AI

Sends a prompt plus the payload to a configured AI provider (local Ollama, or your own OpenAI-compatible or Anthropic endpoint) and replaces the payload with the completion. The system prompt is this step's System prompt field; the user message is the Prompt followed by the payload when one exists. One call per run, never a loop.

- Takes: text (optional) — Produces: text
- Effect: external — parks for approval by default
- Settings:
  - **AI provider** — Which Configure-authored AI provider (local Ollama or a BYO endpoint) this step calls.
  - **System prompt** — Optional system-level instruction sent ahead of the user message. Leave empty for none.
  - **Prompt** — The instruction sent as the user message, followed by the current payload (if any).

### Look up list row

Looks up an Attributes value in a configured List and writes the matched entry back into Attributes.

- Takes: nothing — Produces: its input, unchanged
- Effect: reads local state
- Settings:
  - **List ID** — The ID of a list configured on the Configure page. (references a List)
  - **Input attribute** — Which Attributes field's value to look up.
  - **Output attribute** — Which Attributes field the matched value gets written to.
  - **If no match** — What to do when the input value isn't in the list.
  - **Default value** — Written to the output attribute when there's no match and "If no match" is "default".
  - **Pin to version (optional)** — Leave empty to always resolve this List's current rows. Enter a version number to pin this step to that exact published snapshot, unaffected by later row edits.

### Run a captured command

Runs the captured payload exactly as written, in your real login shell by default, or inside a Configure-authored execution environment (its shell, directory, and variables) when one is chosen. A piped command stays one step; commands separated by a new line or && show as separate steps. External effect: the run asks for your approval by default.

- Takes: text — Produces: text
- Effect: external — parks for approval by default
- Settings:
  - **Execution environment** — Runs the block inside a Configure-authored environment. Empty runs your real login shell. (references an Execution environment)
  - **Run with admin rights** — Runs each command with administrator rights. macOS asks you to approve every run — Touch ID when it's set up for sudo, your password otherwise.

### Run a command

Runs one command locally, inside a configured execution environment (pinned shell, directory, and environment). External effect: the run asks for approval by default. Source "payload" runs the upstream payload as the command; "literal" runs a fixed script instead. A running command can be stopped from this workflow's Runs tab.

- Takes: text (optional) — Produces: text
- Effect: external — parks for approval by default
- Settings:
  - **Execution environment** — Which Configure-authored environment (shell, working directory, env vars) this command runs inside. (references an Execution environment)
  - **Command source** — "payload" runs the captured/upstream payload as the command; "literal" runs the script below instead.
  - **Script** — The command to run when "Command source" is literal. Ignored when source is payload.
  - **Pass input** — How a literal script receives the upstream payload: piped to stdin, or one argument per line ($1, $2, …).
  - **Timeout (seconds)** — Kills the command if it hasn't finished within this many seconds.

### Run another workflow

Runs another of your workflows as a step and uses its result as this workflow's payload. The other workflow must start with the "Called by another workflow" trigger.

- Takes: anything — Produces: anything
- Effect: none — pure computation
- Settings:
  - **Workflow** — Which workflow to run. Only workflows whose trigger is "callable by another workflow" appear here. If the list is empty, create a workflow and drag that trigger onto its canvas first. (references a callable Workflow)
  - **Skip duplicate runs (optional)** — Leave empty to run fresh every time (the normal case). To make repeated runs with the same input reuse the first run's recorded result instead of running again, put a value here that identifies the input: a literal, or attr:<name> to use one of this workflow's attributes.
  - **Pin to version (optional)** — Leave empty to always call the child's published version. Enter a version number to pin this step to that exact snapshot, unaffected by later publishes.
  - **Store result in attribute (optional)** — Also write the child workflow's result into this workflow's named Attribute, so later steps (a Decision condition, another binding) can reference it as attr:<name>.

### Scan a folder for TODO markers

Walks a folder and lists every TODO-style marker it finds as a table: one row per hit with the file, line, marker, and the text after it. Hidden folders, node_modules, vendor and .git are skipped.

- Takes: anything — Produces: text
- Effect: changes something on this machine
- Settings:
  - **Folder** — The folder to scan. A literal path or attr:<name>.
  - **Markers** — Comma-separated words to look for, matched as whole words, case-sensitive.
  - **File types** — Comma-separated extensions to include, e.g. go,ts,md. Blank scans every text file.
  - **File limit** — Stops after this many files so a huge folder never runs away.

### Search list rows

Searches a Configure-authored List's rows against one or more match parameters (exact or fuzzy, per-column, AND'd together) and writes the result into Attributes. Supersedes list-lookup for anything beyond a single exact key match. list-lookup keeps working unchanged for existing workflows. Expired rows are excluded by default; "Include expired rows" opts in.

- Takes: nothing — Produces: its input, unchanged
- Effect: reads local state
- Settings:
  - **List** — The Configure-authored List to search. (references a List)
  - **Match parameters** — JSON array of match criteria, ALL must match (AND): [{"column":"code","value":"attr:code","matchType":"exact"},{"column":"name","value":"Untied States","matchType":"fuzzy","threshold":0.7}]. value is a literal or "attr:<name>". Authored via the Inspector's match-parameter rows; the raw JSON stays available for agent authoring.
  - **Include expired rows** — Off by default. Expired rows never match unless explicitly included.
  - **Stop at first match** — Stops scanning after the first match. The output shape stays the same typed Object either way (results just has at most one entry), so turning this on or off never changes what a downstream Decision/binding can reference.
  - **Output attribute** — Which Attributes field receives the typed search-result object.
  - **Pin to version (optional)** — Leave empty to always resolve this List's current rows. Enter a version number to pin this step to that exact published snapshot, unaffected by later row edits.

### Transform text

Hashes or encodes the payload: SHA-256, base64, URL encoding and more. Hashes are one-way; decoding applies to base64, URL, and hex.

- Takes: text or HTML — Produces: text
- Effect: none — pure computation
- Settings:
  - **Operation** — What to do with the text.

### Validate with rules

Validates the data flowing through this step against a set of named rules (business/data validation, e.g. "amount below limit", "country allowed"). Every rule must pass for the payload to continue unchanged; any failing rule fails the run, naming exactly which rules failed. A rule that cannot evaluate counts as failed (fail-safe). Distinct from Decision (which routes) and from guardrail rules (which govern whether a step may execute at all).

- Takes: anything — Produces: its input, unchanged
- Effect: none — pure computation

## Act

### Back up Mill data

Takes a safe snapshot of your workflow history and settings, deleting older snapshots beyond how many you keep.

- Takes: anything — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **Snapshots to keep** — How many recent backups to keep. Older ones are deleted automatically.

### Create Atlas card

Creates a new card in Atlas of the chosen Kind. "Field values" binds the Kind's own declared fields, each a literal or attr:<name>.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **Kind** — Which Atlas card kind to create.
  - **Title** — The new card's title: a literal or attr:<name>.
  - **Field values** — JSON object mapping the Kind's field keys to a literal or attr:<name>, e.g. {"status":"New","owner":"attr:currentUser"}.
  - **Output attribute (optional)** — Which Attributes field receives the new card's id, so a later step can reference it (e.g. to link it or update it further).

### Create Atlas cards from reply

Creates Atlas records from an accepted clipboard reply's items: an item with a "title" becomes a card of its named kind, an item with "text" becomes a Scratchpad note. "Items" binds the attribute holding the accepted items as a JSON array.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **Items attribute** — Which Attributes field carries the accepted reply items (a JSON array).
  - **Landing space attribute (optional)** — Which Attributes field carries the target space's card id. New cards land there instead of the board root.
  - **Output attribute (optional)** — Which Attributes field receives a summary of what was created.

### Link Atlas cards

Creates a typed relation between two existing Atlas cards. "From"/"To" are each a literal card id or attr:<name>.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **From** — The relation's source card: a literal card id, or attr:<name>.
  - **To** — The relation's target card: a literal card id, or attr:<name>.
  - **Relation** — Which kind of relation this is.
  - **Label (optional)** — An optional note describing this specific relation.

### Mirror delivery ledger from a docs folder

Mirrors every frontmattered markdown file in a folder as a Delivered feature card: a file already mirrored keeps its card and only its mirror-owned fields (goal, shipped date, PRs, proof) refresh. Your sign-off, verified date, and notes are never touched. A new file becomes a new card, pending-verify by default.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **Folder path** — Folder of frontmattered markdown files to mirror as ledger cards.
  - **Parent card title** — Cards land under the card with this title, created if missing. Empty uses the space root.
  - **Output attribute (optional)** — Which Attributes field receives a summary of what changed.

### Mirror docs folder into Atlas

Mirrors every markdown file in a folder as a card under one parent: a file already mirrored keeps its card (checksum refreshed), a new file becomes a new card, so re-running stays safe. The parent card is found by title, or created when missing.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **Folder path** — Folder whose markdown files become mirror cards.
  - **Parent card title** — Cards land under the card with this title, created if missing. Empty uses the space root.
  - **Kind** — Kind label for created cards. Empty uses your first kind.
  - **Output attribute (optional)** — Which Attributes field receives a summary of what changed.

### Move file

Moves or renames a local file to a new location.

- Takes: text (optional) — Produces: text
- Effect: changes something on this machine
- Settings:
  - **Source file** — File to move. Leave empty to use the incoming payload, or set a path or attr: value.
  - **Destination** — Where the file goes. Tokens: {filename} {name} {ext} {date:2006-01-02} {attr:key}. End with / to keep the file's name.
  - **Create missing folders** — Creates the destination's parent folders if they don't exist yet. Off fails the step instead when a folder is missing.
  - **If the destination exists** — Fail stops the step. Suffix adds " (2)", " (3)", and so on to the file name.

### Notify me

Shows a notification when the workflow reaches this step. "Body attribute" swaps the fixed message for an Attributes value.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **Title** — The notification's first line.
  - **Message** — What the notification says.
  - **Body attribute (optional)** — Which Attributes field replaces the fixed message, when set.

### Save list row

Creates or updates a row in a Configure-authored List: if an existing row's "Key column" value matches, only the fields named in "Field values" change (everything else on that row is untouched); otherwise a new row is appended. "Field values" binds the List's own declared column keys, each a literal or attr:<name>.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **List** — The Configure-authored List to write to. (references a List)
  - **Key column** — Which column identifies a row. An existing row whose value in this column matches gets updated; no match appends a new row.
  - **Field values** — JSON object mapping the List's column keys to a literal or attr:<name>, e.g. {"task":"attr:taskName","status":"Done"}. Must include a value for the key column.
  - **Output attribute (optional)** — Which Attributes field receives the row's id.

### Save to clipboard history

Scrubs any known secret value out of the payload, then adds what's left to Clipboard history. Confidential-marked content and Mill's own clipboard writes never reach this step.

- Takes: text — Produces: its input, unchanged
- Effect: changes something on this machine

### Sync rows into a list

Turns a JSON payload's array of items into rows of a Configure-authored List, one row per item, matched by "Key column": an existing row with the same key is updated in the mapped columns, a new key appends a row, and with "Expire missing rows" on, rows whose key is absent from this result are marked expired (never deleted). One-way: nothing is written back to the source, and a later sync overwrites the mapped columns of a row edited by hand.

- Takes: JSON or text or anything — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **List** — The Configure-authored List that mirrors the source. (references a List)
  - **Items path** — Dotted path to the array of items inside the JSON payload, e.g. issues. Blank when the payload itself is the array.
  - **Key column** — The List column that identifies an item. It must be named in the field map.
  - **Field map** — JSON object mapping List column keys to a dotted path inside each item, e.g. {"key":"key","summary":"fields.summary","status":"fields.status.name"}. A value with {{path}} placeholders is a template, e.g. "https://jira.example.com/browse/{{key}}".
  - **Expire missing rows** — Mark rows whose key is absent from this result as expired.

### Update Atlas card

Writes field values onto an existing Atlas card, resolved by "Card" (a literal card id or attr:<name>, e.g. attr:cardId from a trigger-atlas-card event, or an earlier Atlas: find cards result). Only the fields named in "Field values" change; everything else on the card is untouched.

- Takes: nothing — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **Kind** — The card's own Kind. It names which field keys "Field values" may bind.
  - **Card** — Which card to update: a literal card id, or attr:<name>.
  - **Field values** — JSON object mapping the Kind's field keys to a literal or attr:<name>, e.g. {"status":"Processed"}.
  - **Output attribute (optional)** — Which Attributes field receives the updated card's id.

### Write HTML to clipboard

Writes configured HTML to the clipboard.

- Takes: nothing — Produces: HTML
- Effect: changes something on this machine
- Settings:
  - **HTML to write** — The HTML content this step puts on the clipboard.

### Write file

Writes the payload to a local file, appending to or overwriting its existing contents.

- Takes: text — Produces: its input, unchanged
- Effect: changes something on this machine
- Settings:
  - **File path** — Where to write. Use an absolute path, or start with ~ for your home folder.
  - **Mode** — Append adds to the end of the file. Overwrite replaces its entire contents.
  - **Create missing folders** — Creates the file's parent folders if they don't exist yet. Off fails the step instead when a folder is missing.
  - **Timestamp** — Append mode only: "datetime" puts a date-and-time line before each entry. Ignored in overwrite mode.

### Write text to clipboard

Writes the workflow's current payload to the clipboard as plain text.

- Takes: text — Produces: its input, unchanged
- Effect: changes something on this machine

## Flow

### Branch

Routes to one of several next steps based on a rule evaluated against this workflow's Attributes. A pure routing point. Its conditions live on its outgoing edges, not here.

- Takes: anything — Produces: its input, unchanged
- Effect: none — pure computation

## Record

### Record decision

Ends the workflow with a typed, configured outcome: an outcome category (approve/deny/manual-review/action-needed/uncategorized) plus this Decision's own typed result fields. A manual-review outcome parks the run in Review first. Approve continues to the outcome; deny or timeout stops the run. A Decision with a configured webhook fires it on completion.

- Takes: anything — Produces: nothing
- Effect: changes something on this machine
- Settings:
  - **Decision** — Which Configure-authored Decision this terminal step reaches. (references a Decision)
  - **Pin to version (optional)** — Leave empty to always resolve this Decision's current definition. Enter a version number to pin this step to that exact published snapshot, unaffected by later edits.
