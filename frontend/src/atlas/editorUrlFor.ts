// The vendored editor engine's own page-tab strip visibility is
// PERSISTED engine state (mxSettings' own ".drawio-config" key in the
// iframe's own origin) -- shared by every diagram this one iframe ever
// opens, not scoped per file. One diagram's "hide page tabs" toggle
// therefore silently hides the strip on every OTHER diagram from then
// on, with no way back in for a file that genuinely has more than one
// page (goal 0409). Mill's own rule: a multi-page diagram always shows
// its page tabs; a single-page diagram still obeys the engine's own
// View menu toggle, since there is nothing to switch between anyway.
//
// The actual correction runs INSIDE the iframe's own page
// (js/PreConfig.js's Mill-owned block, loaded before app.min.js) --
// a same-origin localStorage write from THIS host page, made before
// the iframe ever mounts, is not observed by the iframe's own
// mxSettings load in every engine (goal 0409's installed-app pass
// found it silently dropped in WKWebView). This helper's only job is
// to tell PreConfig.js a file is multi-page, via the one channel every
// engine reads before its own scripts run: the embed URL itself.
const BASE_EDITOR_URL = '/vendor/drawio/editor/index.html?embed=1&proto=json&spin=1'

// Counts <diagram> elements via DOMParser, never a regexp over XML
// (architecture.md's structured-text rule) -- malformed input parses
// to zero matches rather than throwing, which correctly falls through
// to the single-page URL (nothing to correct).
function diagramPageCount(xml: string): number {
  return new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('diagram').length
}

export function editorUrlFor(initialXML: string): string {
  return diagramPageCount(initialXML) > 1 ? `${BASE_EDITOR_URL}&pages=1` : BASE_EDITOR_URL
}
