// Paints the persisted color mode before React mounts (the same key
// App.tsx writes) -- a separate file rather than an inline script so
// the document's Content-Security-Policy can forbid inline script
// outright (docs/platform/PLUGIN-THREAT-MODEL.md, T9).
(function () {
  try {
    var mode = localStorage.getItem('mill-color-mode') || 'auto'
    document.documentElement.setAttribute('data-color-mode', mode)
    document.documentElement.style.colorScheme = mode === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
  } catch (e) { /* storage unavailable: 'auto' from the markup stands */ }
})()
