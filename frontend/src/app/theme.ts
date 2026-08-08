// Shared localStorage keys for App.tsx's sidebar-collapse and theme
// (light/dark/system) preferences -- split out so main.tsx (which reads
// the color-mode key once, synchronously, before the first render) and
// App.tsx (which reads/writes both afterward) don't duplicate the
// string literal.
export const COLOR_MODE_STORAGE_KEY = 'mill-color-mode'
export const SIDEBAR_OPEN_STORAGE_KEY = 'mill-sidebar-open'
