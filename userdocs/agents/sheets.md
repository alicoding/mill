---
kind: how-to
---

# Edit a sheet with an agent

A sheet on your board is a real CSV file, and the file is the sheet.
An agent connected over MCP reads its cells by range and changes
exactly the ones it names — nothing else in the file moves.

Every change still parks for your approval before it touches the file.

## Read the cells first

`atlas_sheet_read_range` answers with the values in a range (or the
whole sheet, when no range is given) as rows of cells, plus how many
rows and columns the sheet currently holds:

```
atlas_sheet_read_range { "objectId": "<the sheet's board object id>" }

{
  "range": "A1:C3",
  "values": [
    ["Item", "Qty", "Notes"],
    ["Beans", "2", ""],
    ["Rice", "5", "bulk"]
  ],
  "dimensions": { "rows": 3, "cols": 3 }
}
```

Naming a range reads just that rectangle:

```
atlas_sheet_read_range { "objectId": "<id>", "range": "A2:B3" }
```

A cell address is a column letter then a row number, the same way a
spreadsheet addresses one — `B2` is column B, row 2. A range joins two
corners with a colon: `B2:D5`.

## Change a cell or several

`atlas_sheet_edit_cells` changes one or more cells by address in a
single call:

```
atlas_sheet_edit_cells {
  "objectId": "<the sheet's board object id>",
  "edits": [
    { "address": "B2", "value": "3" },
    { "address": "C2", "value": "on sale" }
  ]
}
```

Only the named cells change. Naming a row past the sheet's current
end grows it, padding the cells in between with empty values — the
same thing typing past a row's end does in a real spreadsheet.

## Start a new sheet

`atlas_create_board_object` puts one on the board. A sheet (or a
diagram) can carry its content inline as CSV, and Mill writes the file
for it:

```
atlas_create_board_object {
  "kind": "sheet",
  "payload": { "title": "Groceries" },
  "content": "Item,Qty\nBeans,2\n"
}
```

Only a CSV-backed sheet can be read or edited this way. A sheet backed
by a binary spreadsheet file reads its bytes whole through
`atlas_read_board_object` instead — re-create it as CSV to make it
agent-editable.

## What you see while it happens

Each write shows up as one approval in your words — "Edit 2 cells in
Groceries" — in Review and in the banner. Approve it and the board's
own picture updates on the spot.

Turn the whole thing off in Settings → MCP access; writes are off until
you turn them on.
