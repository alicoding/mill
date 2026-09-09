# Mill identity assets

`mill-mark.svg` is the one editable foreground mark. Run `task icons:regen`
from the repository root with `rsvg-convert` 2.62.3 to regenerate every
checked-in wrapper and source raster plus Wails' iOS icon set. Ordinary Wails
packaging generates ICNS and ICO outputs and, with Xcode 26 available, the
Apple asset catalog. Both paths validate dimensions, alpha treatment,
manifests, source identity, and the formats they produce before returning.

| Consumer | Intended source or variant | Verification |
| --- | --- | --- |
| Sidebar and launch artwork | Rounded app tile | `frontend/src/app/millicon.png`; PNG contract check |
| Browser favicon | Rounded app tile | `frontend/public/mill.svg`; XML contract check |
| PWA any-purpose icons | Rounded app tile at 192 and 512 px | Manifest and PNG contract checks |
| PWA maskable icon | Full-bleed app tile at 512 px | Manifest, opaque-alpha, and safe-area checks |
| Apple touch icon | Full-bleed app tile at 180 px | Parsed HTML link and opaque-alpha checks |
| Browser extension install and toolbar | Rounded app tile at 16, 32, 48, and 128 px | Manifest and PNG contract checks |
| macOS menu bar | Black 44 px foreground on transparency | Template-alpha and hollow-center checks |
| macOS Dock and app bundle | Separate colored foreground and solid platform background | Wails Icon Composer build plus `assetutil` metadata check |
| Legacy macOS and Windows bundles | Rounded 1024 px app tile | Wails ICNS and ICO generation plus format checks |
| Linux bundle | Rounded 1024 px app tile | Existing AppImage packaging consumes `build/appicon.png` |
| iOS bundle | Full-bleed opaque 1024 px source | Isolated Wails `xcode:gen` staging plus pixel check |
| DMG volume and file artwork | Existing packaging artwork and generated app bundle icon | Existing Darwin package tasks; no separate identity injection |
| About, notifications, and system permissions | App-bundle identity | Native platform ownership; no separate icon input |

Plugin and imported-extension icons keep their own identities and are outside
this generation command.
