# Interop consumer

Depends on `mill-interop-provider` and calls its exported `greet`
method. Half of the extension-interop reference pair.

## Dependencies

- `mill-interop-provider` (`>=1.0.0`) -- must be installed and
  activated first; the loader activates a dependency before its
  dependant. Without it, this extension's row reads "Waits for
  mill-interop-provider" instead of activating.

## Try it

Copy both the `mill-interop-provider` and `mill-interop-consumer`
folders into Mill's plugins folder (Settings > Extensions > Open
plugins folder) and reload plugins. Run "Greet the interop provider"
from the command palette; the notice shows the provider's own
greeting, proving the call crossed both extensions' activation frames.
