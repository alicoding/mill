package pluginsvc

// knownCapabilities is the enumerated capability vocabulary
// (docs/adr/0047 §2: enumerated, never free-text). It grows per real
// plugin request, never speculatively -- docs/goals/0249 carries the
// revisit trigger. Split out of pluginservice.go along the file-size
// convention.
var knownCapabilities = map[string]bool{
	// open-url: ask Mill to open an http(s) URL in the default
	// browser. The plugin never receives the primitive; on approval
	// Mill itself performs the open.
	"open-url": true,
	// open-app (goal 0310): open a local path in a NAMED application
	// (a collection folder in Bruno) -- the OS's own open-with, never a
	// shell; server mode approves without performing, like open-url.
	"open-app": true,
	// list-files (goal 0310): list a folder's direct children through
	// Mill (pluginservice_files.go) -- a read-class action, evaluated
	// and audited, never the plugin's own filesystem access.
	"list-files": true,
	// erase-board-items: a drag-shaped canvas tool may hit-test and
	// erase board items through the host's own quick-delete-with-undo
	// door (goal 0252 S2). Enforced host-side in the webview: the
	// gesture ctx only carries the erase calls when the manifest
	// declares this; the ids of hit items never cross into plugin code.
	"erase-board-items": true,
	// fetch: ask Mill to perform an HTTP request against a host the
	// manifest's contributes.network declares (docs/goals/0288). The
	// request is a guarded action (kind net.fetch) executed host-side
	// with confinement to the declared host on every hop; the plugin
	// receives the response, never a socket.
	"fetch": true,
	// read-file (goal 0306 S4): a secret-source plugin's own
	// secrets.js may read the file, or read and list inside the folder,
	// the USER configured its source with -- nothing above it, nothing
	// else on the machine, and no write. The plugin never holds a file
	// handle; the host reads and hands back the bytes.
	"read-file": true,
	// write-content: create notes and cards and append List rows
	// through the guarded content plane (docs/goals/0289) -- the same
	// guard an agent's write takes, kind content.write.
	"write-content": true,
	// edit-card-fields (docs/goals/0357): merge-write named typed-field
	// values onto an existing card -- journaled under the plugin's own
	// undo actor and evaluated as the guarded action kind
	// card.set-fields, so a rule may allow, park, or deny it like any
	// other guarded write. Enforced host-side like erase-board-items:
	// the frame's setCardFields door is armed only while the manifest
	// declares this.
	"edit-card-fields": true,
	// call-integration (goal 0374): read or write against a Configure
	// Integration entity the user picked in the plugin's own settings --
	// never an arbitrary host. Search (read) executes directly; a write
	// (kind external.comment/external.transition) still crosses the
	// guardrail as ClassExternal, evaluated and confirmed inline
	// (pluginservice_guardedwrite.go), never through this door alone.
	"call-integration": true,
}
