/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = 'REPLACE_WITH_YOUR_IMAGE_SERVER';
window.DRAWIO_BASE_URL = null; // Replace with path to base of deployment, e.g. https://www.example.com/folder
window.DRAWIO_VIEWER_URL = null; // Replace your path to the viewer js, e.g. https://www.example.com/js/viewer.min.js
window.DRAWIO_LIGHTBOX_URL = null; // Replace with your lightbox URL, eg. https://www.example.com
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null; // Replace with your custom draw.io configurations. For more details, https://www.drawio.com/doc/faq/configure-diagram-editor
urlParams['sync'] = 'manual';

// Mill-owned block (goal 0409) -- re-apply after any vendor refresh of
// this file. A same-origin localStorage write from Mill's OWN host page,
// made before this iframe ever mounts, is not observed by mxSettings'
// own load on every engine (confirmed divergent from Chromium in
// WKWebView); correcting the persisted setting HERE, inside this page,
// before app.min.js reads `.drawio-config`, is the one seam that works
// everywhere. Runs only when the host marks the file as multi-page
// (`pages=1` on this embed URL, urlParams is already populated by this
// point in bootstrap.js's own load order) -- a single-page file's own
// hide-tabs toggle is left exactly as the user set it.
if (urlParams['pages'] === '1') {
  try {
    var millDrawioConfigRaw = window.localStorage.getItem('.drawio-config');
    if (millDrawioConfigRaw !== null) {
      var millDrawioConfig = JSON.parse(millDrawioConfigRaw);
      if (millDrawioConfig && typeof millDrawioConfig === 'object' && millDrawioConfig.pages === false) {
        delete millDrawioConfig.pages;
        window.localStorage.setItem('.drawio-config', JSON.stringify(millDrawioConfig));
      }
    }
  } catch (e) {
    // Malformed persisted settings -- leave the engine's own defaults in charge rather than throw.
  }
}
