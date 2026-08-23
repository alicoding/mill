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
`STYLE_PATH`, `PROXY_URL`, `DRAWIO_BASE_URL`). Mill's own loader
(`frontend/src/atlas/useDrawioRendering.ts`) sets every one of these to
an empty string *before* this script is loaded, so every base-path
lookup resolves same-origin instead of reaching out to the internet, and
every rendered card is opened with `editable: false` so the viewer never
offers its own external editor. This is the same self-hosting pattern
drawio's own on-prem/enterprise deployments use; it does not require a
patched copy of the file.

## Updating this file

Re-download from the pinned path above at a newer commit, replace this
file, and update the commit/size/checksum fields in this document in the
same change. No other file in this repository depends on this file's
exact bytes beyond its path (`/vendor/drawio/viewer.min.js`, served
as-is from `frontend/public/`).
