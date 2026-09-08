---
kind: how-to
---

# Add a row with an agent

A List is a reusable table other workflows and boards read from. An
agent connected over MCP can read one's full contents and append a new
row to it — never overwrite or reorder a row already there.

Every write still parks for your approval before it touches the List.

## Read the List first

`export_list` answers with a List's full definition — its label,
declared columns, and every row:

```
export_list { "id": "<the List's id>" }

{
  "label": "Groceries",
  "columns": [
    { "key": "item", "label": "Item", "type": "text" },
    { "key": "qty", "label": "Qty", "type": "text" }
  ],
  "rows": [{ "id": "row-1", "values": { "item": "Beans", "qty": "2" } }]
}
```

The column keys are what `list_append_row` takes.

## Append a row

`list_append_row` adds one new row, keyed by the List's own column
keys:

```
list_append_row {
  "listId": "<the List's id>",
  "row": { "item": "Rice", "qty": "5" }
}
```

The new row lands at the end. Every row already there — its values,
its order — stays exactly as it was.

## Start a new List

`import_list` mints a brand-new List from an exported-list JSON
definition (the same shape `export_list` above returns) — it never
overwrites an existing one. Use `list_append_row` to grow a List that
already exists.

## What you see while it happens

Each write shows up as one approval in your words — "Append a row to
Groceries" — in Review and in the banner. Approve it and every open
view of the List updates on the spot.

Turn the whole thing off in Settings → MCP access; writes are off until
you turn them on.
