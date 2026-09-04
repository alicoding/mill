// The native menu bar's fixed shape: which menus exist, in which order,
// and where the platform's own standard items sit among the bands
// commands fill. Everything here is structure -- no command is named
// except where one menu surfaces a command that lives in another
// (`commandRef`); a command declares its own seat with `Command.menu`.
//
// The order and the standard blocks follow Apple's Human Interface
// Guidelines for the menu bar: the app menu opens with About and
// Settings and closes with the Hide/Show All block then Quit; an app's
// own menus sit between View and Window; developer affordances stay out
// of View.

export type MenuPath = 'app' | 'file' | 'file.new' | 'view' | 'workflow' | 'atlas' | 'window' | 'help' | 'help.developer'

// A standard item the platform supplies and localises itself -- Mill
// never gives these a label or a handler.
export type MenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'showAll'
  | 'quit'
  | 'edit'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'toggleFullscreen'
  | 'minimise'
  | 'zoom'
  | 'bringAllToFront'
  | 'reload'
  | 'forceReload'
  | 'openDevTools'

export type MenuSlot =
  // `releaseAccelerator` strips the key equivalent the platform ships
  // this role with, leaving the item clickable but its combo free for
  // whichever in-window listener already owns the same action -- the
  // one-owner-per-combo rule applied in the only direction a standard
  // item allows.
  | { role: MenuRole; releaseAccelerator?: boolean }
  // Every command placed at this menu's path with this band number,
  // in the order each declared.
  | { commandGroup: number }
  // One command by id, wherever it declared its own seat -- for the
  // rare item that belongs in two menus (Docs is a view you can open
  // and the app's help page).
  | { commandRef: string; label?: string }
  | { submenu: { label: string; path: MenuPath; groups: MenuSlot[][] } }

export type MenuSkeletonEntry =
  | { label: string; path: MenuPath; groups: MenuSlot[][]; role?: undefined }
  | { label: string; role: MenuRole; path?: undefined; groups?: undefined }

export const MENU_SKELETON: readonly MenuSkeletonEntry[] = [
  {
    label: 'menu.menus.mill',
    path: 'app',
    groups: [
      [{ role: 'about' }, { commandGroup: 0 }],
      [{ commandGroup: 1 }],
      // Back up now (goal 0335): its own band, directly under Settings.
      [{ commandGroup: 2 }],
      [{ role: 'services' }],
      [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'showAll' }],
      [{ role: 'quit' }],
    ],
  },
  {
    label: 'menu.menus.file',
    path: 'file',
    groups: [
      [{ commandGroup: 0 }],
      // New… (goal 0335): the per-Configure-tab create commands, in
      // their own submenu rather than crowding File's top band.
      [{ submenu: { label: 'menu.submenus.fileNew', path: 'file.new', groups: [[{ commandGroup: 0 }]] } }],
      [{ commandGroup: 1 }],
      [{ commandGroup: 2 }],
      // Export band (goal 0335).
      [{ commandGroup: 3 }],
      // The vault seat (goal 0335): one item, its command and label
      // following vaultStatusStore's own state (shared/menuSpec.ts's
      // seatOverrides).
      [{ commandGroup: 4 }],
    ],
  },
  // The platform's own text-editing menu, contents included: Undo, Cut,
  // Copy, Paste, Select All and Speech all act on whatever view is
  // first responder, which is the webview.
  { label: 'menu.menus.edit', role: 'edit' },
  {
    label: 'menu.menus.view',
    path: 'view',
    groups: [
      [{ commandGroup: 0 }],
      [{ commandGroup: 1 }],
      [{ commandGroup: 2 }],
      // Clipboard history (goal 0335): its own band.
      [{ commandGroup: 3 }],
      [
        // ⌘0/⌘+/⌘- are Mill's own: Go to Home, and the canvas zoom the
        // editor's listener drives off a live selection. The zoom
        // commands still work from here by click.
        { role: 'resetZoom', releaseAccelerator: true },
        { role: 'zoomIn', releaseAccelerator: true },
        { role: 'zoomOut', releaseAccelerator: true },
        { role: 'toggleFullscreen' },
      ],
    ],
  },
  {
    label: 'menu.menus.workflow',
    path: 'workflow',
    groups: [[{ commandGroup: 0 }], [{ commandGroup: 1 }], [{ commandGroup: 2 }]],
  },
  {
    label: 'menu.menus.atlas',
    path: 'atlas',
    groups: [[{ commandGroup: 0 }], [{ commandGroup: 1 }], [{ commandGroup: 2 }]],
  },
  {
    label: 'menu.menus.window',
    path: 'window',
    groups: [[{ role: 'minimise' }, { role: 'zoom' }], [{ commandGroup: 0 }], [{ role: 'bringAllToFront' }]],
  },
  {
    label: 'menu.menus.help',
    path: 'help',
    groups: [
      [{ commandRef: 'view.docs', label: 'menu.items.millHelp' }, { commandGroup: 0 }],
      [{ commandGroup: 1 }],
      [
        {
          submenu: {
            label: 'menu.submenus.helpDeveloper',
            path: 'help.developer',
            groups: [[{ role: 'reload' }, { role: 'forceReload' }, { role: 'openDevTools' }], [{ commandGroup: 0 }]],
          },
        },
      ],
    ],
  },
]

// The names macOS gives the standard items, for the menu-bar reference
// page only -- the platform supplies, and localises, the real labels;
// nothing in the app reads these.
export const MENU_ROLE_NAMES: Record<MenuRole, string> = {
  about: 'About Mill',
  services: 'Services',
  hide: 'Hide Mill',
  hideOthers: 'Hide Others',
  showAll: 'Show All',
  quit: 'Quit Mill',
  edit: 'Undo, Redo, Cut, Copy, Paste, Select All, Speech',
  resetZoom: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  toggleFullscreen: 'Enter Full Screen',
  minimise: 'Minimize',
  zoom: 'Zoom',
  bringAllToFront: 'Bring All to Front',
  reload: 'Reload',
  forceReload: 'Force Reload',
  openDevTools: 'Open Developer Tools',
}
