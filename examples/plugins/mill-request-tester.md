# Request tester

Sends an HTTP request to any host you approve, and reads the response
in its own work tab. Every send is a guarded request: with any host
declared, Mill parks each one for your approval in Review.

The response is drawn by Mill's own output viewer
(`api.ui.renderOutput`): JSON opens as a tree, an array of objects as a
table, anything else as a numbered log, with Find, Copy and Raw on the
same toolbar.

## Settings

- **Default method** -- the method a new request starts with.
- **Authorization** -- a vault entry sent as a bearer token with every
  request; the plugin only ever learns its title, never its value.

## Capabilities

- `fetch` -- sends the request you build, on your approval.

## Try it

Copy the `mill-request-tester` folder into Mill's plugins folder
(Settings > Extensions > Open plugins folder) and reload plugins. Open
its tab, enter an address, and click Send.
