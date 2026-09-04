# Web clipper

Clips a web page's article into a note, with its source address kept.
Fetching, reading and converting the page all go through Mill's own
guarded doors -- nothing the plugin does reaches the network on its
own.

## Settings

None.

## Capabilities

- `fetch` -- fetches the page you enter, on your approval (every
  request parks for approval since the plugin declares any host).
- `write-content` -- creates the note holding the clipped article.

## Try it

Copy the `mill-clipper` folder into Mill's plugins folder (Settings >
Extensions > Open plugins folder) and reload plugins. Place a Web
clipper object, enter an article's address, and click Clip to a note.
