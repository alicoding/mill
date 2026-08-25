# Vendored: drawio's own static diagram viewer

- **File**: `viewer.min.js`
- **Upstream**: https://github.com/jgraph/drawio
- **Path upstream**: `src/main/webapp/js/viewer.min.js`
- **Pinned commit**: `85a95c9066d8db7e90a2a2aa25f1179945d08ab6` (branch `dev`)
- **Fetched from**: `https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/js/viewer.min.js`
- **License**: Apache License 2.0 (SPDX `Apache-2.0`) — repo-wide, confirmed
  against `LICENSE` at the pinned commit; the vendored file's own header
  reads `Copyright (c) 2006-2016, JGraph Holdings Ltd`.
- **Size**: 2,675,343 bytes
- **SHA-256**: `0c44747cb40c92738082b8dc045787df9fa1f309985b0c0d916e65adef8923fd`

## Why this file, unmodified

Mill's board-unit registry (ADR-0043, goal 0133 slice 3) renders `.drawio`
cards by adopting drawio's own client-side viewer rather than
reimplementing mxGraph rendering — the file is used as-is, no build step,
no patching.

## Self-hosting requirement (Mill's own no-remote-fetches constraint)

This file's own top-level code defaults several resource base paths to
live `https://viewer.diagrams.net/...` / `https://app.diagrams.net`
endpoints via a `window.X = window.X || "<remote default>"` pattern
(`mxBasePath`, `mxImageBasePath`, `STENCIL_PATH`, `SHAPES_PATH`,
`STYLE_PATH`, `PROXY_URL`, `DRAWIO_BASE_URL`, and more —
`useDrawioRendering.ts`'s `LOCAL_ONLY_PATHS` enumerates the full set).
Mill's own loader (`frontend/src/atlas/useDrawioRendering.ts`) pins
every one of these to a same-origin path *before* this script is
loaded, so every base-path lookup resolves locally instead of reaching
out to the internet, and every rendered card is opened with
`editable: false` so the viewer never offers its own external editor.
This is the same self-hosting pattern drawio's own on-prem/enterprise
deployments use; it does not require a patched copy of the file.
`STENCIL_PATH` is the one exception pinned to real, populated data
rather than a dead path — see the stencil data section below.

## Updating this file

Re-download from the pinned path above at a newer commit, replace this
file, and update the commit/size/checksum fields in this document in the
same change. No other file in this repository depends on this file's
exact bytes beyond its path (`/vendor/drawio/viewer.min.js`, served
as-is from `frontend/public/`).

## Vendored: General/Flowchart stencil data (`stencils/`)

- **Files**: `stencils/basic.xml`, `stencils/flowchart.xml`,
  `stencils/LICENSE`
- **Upstream**: https://github.com/jgraph/drawio
- **Paths upstream**: `src/main/webapp/stencils/basic.xml`,
  `src/main/webapp/stencils/flowchart.xml`,
  `src/main/webapp/stencils/LICENSE`
- **Pinned commit**: `85a95c9066d8db7e90a2a2aa25f1179945d08ab6` — the
  SAME commit `viewer.min.js` above is pinned to; the stencil format is
  read directly by that exact vendored build of the viewer, so the two
  can't drift independently.
- **Fetched from**:
  `https://raw.githubusercontent.com/jgraph/drawio/85a95c9066d8db7e90a2a2aa25f1179945d08ab6/src/main/webapp/stencils/{basic.xml,flowchart.xml,LICENSE}`
- **Sizes**: `basic.xml` 43,925 bytes; `flowchart.xml` 33,227 bytes;
  `LICENSE` 630 bytes.
- **SHA-256**: `basic.xml`
  `674166a4b4315f78cd6739bd5eb14869cc25abc48f71109d9a157976b5a1573f`;
  `flowchart.xml`
  `fb3a97bb4c3c481c103206acb74802d09889a59bd3dedfea024e293d469ca39a`;
  `LICENSE`
  `f4098ff053b5954abbf69b15811ef06cd277847ca49934beda355c3d841ebdac`
- **License**: the stencil subtree carries its OWN license, distinct
  from the repo-wide Apache-2.0 above — read `stencils/LICENSE`
  verbatim. It layers an Atlassian-products/marketplace carve-out on
  top of Apache-2.0 (icon/stencil assets, and derivatives of them, may
  not be redistributed as software assets in or for Atlassian products
  or the Atlassian marketplace without explicit permission; end-user
  diagram *output* — exported images/documents made with this software
  — is unrestricted). Mill only renders these stencils inside its own
  viewer and never redistributes the stencil files themselves as an
  Atlassian-ecosystem asset, so this does not block vendoring; the file
  ships alongside the data specifically so that constraint travels with
  it rather than being assumed identical to the root license.

### Why these two files, not the full stencil universe

`viewer.min.js`'s own `mxStencilRegistry.libraries` table (goal 0224's
research verdict) maps a style's `mxgraph.<family>.*` prefix to a
per-family pair of resources: a `SHAPES_PATH` JS painter and a
`STENCIL_PATH` XML file, loaded independently — a missing JS painter
404s and is skipped silently (a status check, not a thrown error), so
XML alone is sufficient to render real stencil geometry for a family.
`basic` and `flowchart` are tens of KB of pure path/geometry XML with
no JS painter dependency and no external references (grepped for
`http` in both files — none). Icon packs (AWS/Azure/Cisco/network/...)
are multi-MB and pair with real JS painter bundles for icon rendering —
out of this slice's scope; every OTHER family still resolves against
`useDrawioRendering.ts`'s dead `LOCAL_ONLY_BASE` and degrades to a
default box, unchanged from before this change.

### Updating these files

Re-download from the pinned commit above (or a newer one shared with
`viewer.min.js`), replace the files, and update this section's
commit/size/checksum fields in the same change. Adding another family
means adding its `STENCIL_PATH` XML file here (and its `SHAPES_PATH` JS
painter too, if that family's shapes need one beyond generic stencil
paths) plus a PROVENANCE entry — never assume a new family needs no
JS painter without checking `mxStencilRegistry.libraries` for it.
