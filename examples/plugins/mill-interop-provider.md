# Interop provider

Exports one method, `greet`, for another extension to call. Half of the
extension-interop reference pair, alongside `mill-interop-consumer`.

## Exports

- `greet(name)` -- returns a greeting string. Reachable only by an
  extension that declares `mill-interop-provider` in its own manifest
  `dependencies`.

## Try it

Copy both the `mill-interop-provider` and `mill-interop-consumer`
folders into Mill's plugins folder (Settings > Extensions > Open
plugins folder) and reload plugins. Run "Greet the interop provider"
from the command palette.
