# Edit a diagram with an agent

A diagram on your board is a real file, and the file is the diagram.
An agent connected over MCP reads its shapes by id and changes exactly
the ones it names — nothing else in the file moves. Your other pages,
your layers, your styling and every id you already arranged all stay
put, because nothing is regenerated.

Every change still parks for your approval before it touches the file.

## Read the shapes first

`atlas_read_diagram` answers with the diagram's pages, the layers on
the page it read, and every shape and connector on it:

```
{
  "format": "drawio",
  "pages": [{ "id": "page1", "name": "Runtime path" }],
  "activePage": "page1",
  "layers": [{ "id": "1", "name": "", "visible": true }],
  "cells": [
    { "id": "2", "kind": "vertex", "label": "Gateway",
      "style": "rounded=0;whiteSpace=wrap;html=1;",
      "parent": "1",
      "geometry": { "x": 120, "y": 120, "width": 160, "height": 60 } }
  ]
}
```

Those ids are what every other tool takes.

## Add a box, connect it, rename it

Add a shape and the connector joining it to the one already there:

```
atlas_diagram_add_cells {
  "objectId": "<the diagram's board object id>",
  "cells": [
    { "kind": "vertex", "label": "Ledger",
      "geometry": { "x": 360, "y": 120, "width": 160, "height": 60 } },
    { "kind": "edge", "label": "writes to", "source": "2", "target": "<the new id>" }
  ]
}
```

The call answers with the ids the new cells landed under — Mill mints
one for any cell that didn't bring its own. Use the returned id to
rename it later:

```
atlas_diagram_edit_cells {
  "objectId": "<the diagram's board object id>",
  "patches": [{ "id": "<the new id>", "label": "Ledger service" }]
}
```

Only what a patch names changes. Geometry merges coordinate by
coordinate, so moving a shape leaves its size alone.

Removing it takes the connector with it, and the answer says which
connectors went:

```
atlas_diagram_delete_cells {
  "objectId": "<the diagram's board object id>",
  "ids": ["<the new id>"]
}
```

## Bring in a whole diagram

`atlas_diagram_import` takes a mode:

- **add** merges the incoming shapes into a page and re-mints any id
  that collides with one already there, reporting the map.
- **new-page** files the incoming diagram as its own page.
- **replace** overwrites the file. Everything already in it — ids,
  layers, other pages — is gone.

Prefer add or new-page. Replace is the only mode a Mermaid diagram
accepts, because Mermaid has no per-shape ids to edit against.

## Start a new diagram

`atlas_create_board_object` puts one on the board. A diagram (or a
sheet) can carry its content inline, and Mill writes the file for it:

```
atlas_create_board_object {
  "kind": "diagram",
  "payload": { "title": "Runtime path" },
  "content": "<mxfile>…</mxfile>"
}
```

Every other file-backed object points at a file that already exists,
through `payload.mirrorPath`.

## What you see while it happens

Each write shows up as one approval in your words — "Add 2 shapes to
Runtime path" — in Review and in the banner. Approve it and the board's
own picture updates on the spot. If you have the diagram open in the
editor, the change lands in it too, without losing what you were in the
middle of.

Turn the whole thing off in Settings → MCP access; writes are off until
you turn them on.
