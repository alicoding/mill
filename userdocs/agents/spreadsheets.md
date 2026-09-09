---
kind: how-to
---

# Edit a spreadsheet file with an agent

A sheet on your board can be backed by a real spreadsheet file — the
file is the sheet, formulas and formatting included. An agent
connected over MCP reads its cells (and any formulas) by range and
changes exactly the cells it names — every other cell, every style,
every other sheet in the file stays exactly as it was.

Every change still parks for your approval before it touches the file.

## Read the cells first

`atlas_xlsx_read_range` answers with the values in a range (or the
whole sheet, when no range is given), plus each cell's own formula
where it has one:

```
atlas_xlsx_read_range { "objectId": "<the sheet's board object id>" }

{
  "sheet": "Sheet1",
  "range": "A1:C3",
  "values": [
    ["Item", "Qty", "Total"],
    ["Coffee beans", "2", "9"],
    ["Oat milk", "1", "3"]
  ],
  "formulas": [
    ["", "", ""],
    ["", "", "B2*4.5"],
    ["", "", "B3*3"]
  ],
  "dimensions": { "rows": 3, "cols": 3 }
}
```

A cell address is a column letter then a row number, the same way a
spreadsheet addresses one — `B2` is column B, row 2. A range joins two
corners with a colon: `B2:D5`. `sheet` picks which sheet by name;
leave it out for the workbook's first sheet.

A formula's value is never recalculated here — it reads back whatever
was last cached. Formulas recalculate when the file next opens in a
spreadsheet app.

## Change a cell or several

`atlas_xlsx_edit_cells` changes one or more cells by address in a
single call. Each edit names exactly one of `value` (literal text) or
`formula` (a computed cell):

```
atlas_xlsx_edit_cells {
  "objectId": "<the sheet's board object id>",
  "sheet": "Sheet1",
  "edits": [
    { "address": "B2", "value": "3" },
    { "address": "D2", "formula": "B2*4.5" }
  ]
}
```

Only the named cells change. Every other cell, every style, every
merged range and every other sheet in the file comes back unchanged.

## What you see while it happens

Each write shows up as one approval in your words — "Edit 2 cells in
Orders" — in Review and in the banner. Approve it and the board's own
picture updates on the spot.

Turn the whole thing off in Settings → MCP access; writes are off until
you turn them on.
