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

## Vendored: the full editor webapp (`editor/`)

- **Directory**: `editor/`
- **Upstream**: https://github.com/jgraph/drawio, `src/main/webapp/`
- **Pinned commit**: `85a95c9066d8db7e90a2a2aa25f1179945d08ab6` (branch
  `dev`) — the SAME commit already pinned for `viewer.min.js` and the
  stencils above; at the time this was vendored, `dev`'s tip happened
  to equal that exact commit, so the whole vendored surface (read-only
  viewer + full editor) is pinned to one upstream snapshot.
- **Fetched via**: `git clone --branch dev --depth 1
  https://github.com/jgraph/drawio.git`, `git rev-parse HEAD` confirmed
  against the commit above before copying.
- **License**: Apache License 2.0 (SPDX `Apache-2.0`), repo-wide, same
  as `viewer.min.js` above — plus the per-subtree carve-outs below,
  each shipped alongside its own data so the restriction travels with
  the content rather than being assumed identical to the root license.
- **Size**: 109MB, 3,055 files (down from the upstream tree's 152MB —
  goal 0237's owner ruling is that size is NOT a target to optimize
  for; every byte trimmed below is dead weight unreachable from this
  vendor's own entry point, never a capability cut).
- **Entry-point checksums** (SHA-256, the files `index.html`'s own load
  chain reaches directly):
  - `index.html`:
    `e1d2cc03e8f21296e14869e302c84781e8b4768615d6ef4260caa50e7fa26d59`
  - `js/bootstrap.js`:
    `6fa85a4b6b9478dfe77167f6c1721a24a191faa80ae20b3f8edeb02a2c2a8a17`
  - `js/main.js`:
    `f2967ad73f4d8d20d8a910208a9ae8998d8c0dbaba90f5be049105b8496aa01d`
  - `js/PreConfig.js`:
    `e49e4c8de81550441fac906553122f707dba51f38bd3caee9cd20d2413741342`
  - `js/PostConfig.js`:
    `cd3bb1ed454e26e77a1997182324df84f63227d7b49e19f098396d68ea9d24cc`
  - `js/app.min.js` (the editor bundle itself):
    `da0b1b6e98884ca1722391ea737981cdb84c9eb38d496c32cf33899ecfec8946`

### Why this directory, not just `viewer.min.js`

`viewer.min.js` above is a deliberately minimal, read-only render path
(`editable: false`, goal 0133) for card previews. Goal 0237 slice 1
mounts draw.io's REAL editor inside Mill (select a diagram board object
→ Edit → save → the existing mirror-watch updates the preview) — that
needs the actual editor application (`index.html` + `js/app.min.js` +
every asset it lazy-loads: stencils, shape libraries, templates,
extensions), not the static viewer. The two vendored surfaces are
independent and don't share files — `viewer.min.js` keeps serving card
previews unchanged.

### Self-hosting: how this tree avoids reaching the internet

Unlike `viewer.min.js` (which required Mill's own loader to pin a
`LOCAL_ONLY_PATHS` list before the script ran), the full webapp ships
its OWN self-hosting mechanism: `js/PreConfig.js` is draw.io's
documented on-premises deployment config, and it already sets
`DRAWIO_BASE_URL` / `DRAWIO_VIEWER_URL` / `DRAWIO_LIGHTBOX_URL` /
`DRAWIO_CONFIG` to `null` rather than a remote default — this file
ships unmodified, exactly as upstream's own self-host documentation
instructs. `js/bootstrap.js`'s own load-path selection
(`supportedDomain` — a hostname check for `*.draw.io`/
`*.diagrams.net`) is false for any host Mill serves from, so the
production (non-Electron, non-dev) branch loads only local relative
paths: `js/PreConfig.js` → `js/app.min.js` → `js/PostConfig.js`, no
`js/integrate.min.js` (removed below) and no Electron-only lazy loads.
Verified empirically, not just by reading the config: the contract
test/e2e coverage for the embedded editor asserts zero network
requests to any non-same-origin host while the editor is mounted and
in use (mirroring `atlas-drawio-unit.spec.ts`'s existing assertion for
the viewer).

### What was trimmed, and why (all confirmed unreachable from `index.html`'s own production load path before removal — `js/bootstrap.js`'s `dev`/Electron/`supportedDomain` branches were read first, not assumed)

- **`WEB-INF/`, `META-INF/`** — Java servlet/appengine deployment
  config and OAuth client-secret placeholders for a server backend;
  server-side, not part of a static client bundle.
- **`connect/`** — OAuth connect-flow pages for cloud storage
  providers (Drive/Dropbox/OneDrive/GitHub/GitLab); grepped for
  references from `index.html` and `js/app.min.js` — none found, it is
  reachable only from the cloud-storage HTML pages removed below.
- **`js/integrate.min.js`** (21MB) — the cloud-storage/cloud-conversion
  integrations bundle (Drive/Dropbox/OneDrive/GitHub/GitLab/Trello/
  cloud-convert); `js/bootstrap.js`'s production load path never
  references it, and Mill has no cloud-storage connector for it to
  serve.
- **`js/onedrive/`, `js/dropbox/`** — per-provider cloud-storage JS
  clients, same family as `integrate.min.js`.
- **`js/simplepeer/`** — WebRTC transport for realtime multi-user
  collaboration, which requires a remote signaling server
  (`rt.draw.io` upstream) Mill never configures or reaches (no
  phone-home, §1.1).
- **Root cloud/service HTML pages**: `onedrive3.html`, `dropbox.html`,
  `gitlab.html`, `github.html`, `teams.html`,
  `monday-app-association.json`, `vsdxImporter.html`, `export3.html`,
  `open.html`, `clear.html` — alternate entry points for cloud-storage
  flows and a cache-clearing utility page; Mill's iframe mount always
  loads `index.html` directly with its own URL parameters (never these
  pages), so they're unreachable dead weight.
- **`js/diagramly/`, `js/grapheditor/`, `mxgraph/`** (top-level,
  12.2MB + 3.3MB) — the uncompressed, unbundled editor source trees.
  `js/bootstrap.js`'s own `dev`/production branch shows these are
  loaded ONLY when `?dev=1` is set (`geBasePath = 'js/grapheditor'`,
  `mxBasePath = 'mxgraph/src'`, individual `js/diagramly/*.js`
  `<script>` tags) — the production branch Mill's embed always takes
  loads `js/app.min.js` alone, which already contains this source
  compiled in. Removing the dev-mode source trees doesn't remove any
  capability the production bundle has.
- **`js/clear.js`** — paired only with the removed `clear.html`.

### What was KEPT despite size, because it renders or edits

`js/stencils.min.js` (7.2MB), `js/extensions.min.js` (3.7MB),
`js/shapes-14-6-5.min.js` (1.4MB), `js/elk/`, `js/mermaid/`,
`js/libavoid-js/`, `js/gliffy/`, `js/orgchart*`, `js/plantuml/` — all
lazy-loaded by `js/app.min.js` at runtime when the corresponding editor
feature (shape libraries, layout, format import) is actually used, not
referenced by `js/bootstrap.js`'s initial script tag; `stencils/`
(41MB, the FULL shape-library stencil XML — deliberately the complete
set here, unlike the `basic`/`flowchart`-only carve-out vendored
separately above for the minimal read-only viewer), `shapes/` (2.3MB),
`img/` (11MB), `images/` (6.5MB), `resources/` (5.5MB, the editor's own
UI locale strings), `templates/` (5.4MB, the New Diagram template
gallery), `plugins/` (376KB), `math4/` (3.3MB, LaTeX/MathJax typesetting
for shapes), `styles/`, `service-worker.js` + its `workbox-*` bundle.

### Per-subtree license carve-outs found in this tree

- `stencils/LICENSE`, `shapes/LICENSE`, `img/LICENSE` — byte-identical
  to the Atlassian-marketplace carve-out already documented above for
  the top-level `stencils/` folder: icon/stencil assets (and
  derivatives) may not be redistributed as software assets in or for
  Atlassian products or the Atlassian marketplace without permission;
  end-user diagram output is unrestricted. Mill only renders this
  content inside its own vendored editor.
- `templates/LICENSE` — Creative Commons Attribution 4.0 International
  (CC BY 4.0): the New Diagram template gallery's own content, requires
  attribution if shared/redistributed as-is; Mill vendors it unmodified
  as part of the editor application, the same distribution shape
  upstream's own WAR/on-prem build uses.
- `js/libavoid-js/LICENSE` — GNU LGPL v2.1: the compiled
  `libavoid.min.js` orthogonal-edge-routing bundle is a build artifact
  of a separate LGPL-licensed project, distributed here unmodified
  (dynamically loaded at runtime, never statically linked into Mill's
  Go binary), matching upstream draw.io's own official distribution of
  the same file.

### Updating this directory

Re-download via the same `git clone --branch dev --depth 1` command
above at a newer commit, re-copy `src/main/webapp/`, re-apply the same
trim list (re-verify each entry is still unreferenced from
`index.html`'s production load path before removing it — an upstream
change could start referencing something previously dead), and update
this section's commit/size/checksum fields in the same change. Per the
no-catch-up-tax rules (`docs/goals/0237-embedded-editor-engines.md`),
this bundled copy is a convenience snapshot allowed to age — updating
it is never required by a Mill release, only by a deliberate refresh.
