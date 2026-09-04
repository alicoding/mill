// Paints the persisted appearance before React mounts (the same keys
// shared/appearance.ts writes) -- a separate file rather than an inline
// script so the document's Content-Security-Policy can forbid inline
// script outright (docs/platform/PLUGIN-THREAT-MODEL.md, T9).
//
// It repeats appearance.ts's resolution rather than importing it: this
// runs before the module graph exists, and the whole point is that the
// first painted frame already carries the right palette. The scheme
// lists and the high-contrast pairing are the only knowledge the two
// share, and appearance.test.ts pins both sides against the stylesheets
// that paint them.
(function () {
  var HIGH_CONTRAST_PAIR = {
    light: 'light_high_contrast',
    light_colorblind: 'light_colorblind_high_contrast',
    light_tritanopia: 'light_tritanopia_high_contrast',
    dark: 'dark_high_contrast',
    dark_dimmed: 'dark_dimmed_high_contrast',
    dark_colorblind: 'dark_colorblind_high_contrast',
    dark_tritanopia: 'dark_tritanopia_high_contrast',
  }
  var LIGHT = ['light', 'light_high_contrast', 'light_colorblind', 'light_colorblind_high_contrast', 'light_tritanopia', 'light_tritanopia_high_contrast']
  var DARK = ['dark', 'dark_dimmed', 'dark_high_contrast', 'dark_colorblind', 'dark_colorblind_high_contrast', 'dark_tritanopia', 'dark_tritanopia_high_contrast']
  try {
    var read = function (key) { try { return localStorage.getItem(key) } catch (e) { return null } }
    var pick = function (value, allowed) { return allowed.indexOf(value) === -1 ? allowed[0] : value }
    var stored = read('mill-color-mode')
    var mode = stored === 'light' || stored === 'dark' ? stored : 'auto'
    var light = pick(read('mill-light-scheme'), LIGHT)
    var dark = pick(read('mill-dark-scheme'), DARK)
    if (mode === 'auto' && matchMedia('(prefers-contrast: more)').matches) {
      light = HIGH_CONTRAST_PAIR[light] || light
      dark = HIGH_CONTRAST_PAIR[dark] || dark
    }
    var resolved = mode === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
    var root = document.documentElement
    root.setAttribute('data-color-mode', mode)
    root.setAttribute('data-light-theme', light)
    root.setAttribute('data-dark-theme', dark)
    root.setAttribute('data-mill-theme', resolved)
    root.setAttribute('data-mill-scheme', resolved === 'dark' ? dark : light)
    root.style.colorScheme = resolved
  } catch (e) { /* storage unavailable: the markup's own defaults stand */ }
})()
