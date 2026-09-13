package pluginsvc

// PluginInfo is one scanned plugin as the Extensions surface and the
// loader see it. Error is a load-blocking validation problem stated
// for the human (the row renders it; the loader skips the plugin) --
// a plugin is either fully valid or visibly broken, never silently
// half-loaded. Builtin marks a plugin embedded in the binary
// (pluginservice_builtin.go): same loader and disable list as any
// plugin, but nothing on disk to reveal or delete.
type PluginInfo struct {
	Manifest Manifest
	Dir      string
	Error    string
	Builtin  bool
	// ContentHash is the folder's current content hash
	// (pluginservice_hash.go), "" for a built-in or an invalid plugin
	// -- what signature verification (Signed) checks against. NOT what
	// the lock compares against; that is CodeHash (docs/goals/0375 S2).
	ContentHash string
	// CodeHash excludes manifest.json (docs/goals/0375 S2): the trust
	// lock's own comparison input, so a manifest-only edit never trips
	// it -- only Widened does.
	CodeHash string
	// SigningPolicy reports whether an administrator pinned signing
	// keys; Signed whether this folder's signature verified against one
	// (pluginservice_signing.go). Both false with no policy.
	SigningPolicy bool
	Signed        bool
	// Tier is the install trust tier (trust.go, docs/goals/0349): what
	// actually checked these bytes when they landed. "" for a built-in.
	Tier string
	// Marketplace names the index this folder was installed from, ""
	// when it arrived some other way.
	Marketplace string
	// ApprovalState is the consent verdict calculated for this scanned
	// package from one detached approval revision. Non-built-in values
	// are exactly allowed, unallowed, changed, or unavailable. Built-ins
	// leave it empty because package approval does not apply to them.
	ApprovalState string
	// PolicyBlocked is the organisation policy's refusal sentence
	// (policy_match.go), "" when no policy refuses this folder. A
	// refused plugin stays listed and never runs.
	PolicyBlocked string
	// Grants names what this plugin was given outside the sandboxed
	// activation frame every other non-built-in plugin runs inside
	// (docs/goals/0375 S1b): "canvas-host" for a non-built-in plugin
	// that declares a canvas object, since the framed canvas API does
	// not exist yet and its own tools still need board input the way a
	// built-in's do. Always empty for a built-in.
	Grants []string
	// Widened is non-nil for a non-built-in plugin whose manifest
	// declares MORE than its own consent covered (docs/goals/0375 S2,
	// MV3's re-consent-on-widen rule): the NEW elements only, in the
	// shape permissionLines() renders. Nil when narrowed/unchanged,
	// never allowed, or built-in.
	Widened *InstallPreview
	// Warnings are non-blocking manifest notices -- a deprecated key
	// still in use, a foreign menu id Mill has no seat for
	// (docs/goals/0349 S2) -- stated once in the plugin's status. A
	// plugin with a load-blocking Error may still carry these; the
	// status pane shows the error first.
	Warnings []string
	// DataOnly is authoritative only after manifest validation: this
	// extension contributes themes and has no executable surface.
	DataOnly bool
	// ThemeImport carries the preserved adapter evidence for an imported
	// standalone theme file, and is nil for every other extension.
	ThemeImport *ThemeImportMetadata
}
