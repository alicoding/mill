package pluginsvc

// PluginInfo is one scanned plugin as the Extensions surface and the
// loader see it. Error is a load-blocking validation problem stated
// for the human (the row renders it; the loader skips the plugin) --
// a plugin is either fully valid or visibly broken, never silently
// half-loaded. Builtin marks a plugin embedded in the binary
// (pluginservice_builtin.go): same loader and disable list as any
// plugin, but nothing on disk to reveal or delete. Split from
// pluginservice.go at the hand-written-file line limit
// (.claude/rules/architecture.md).
type PluginInfo struct {
	Manifest Manifest
	Dir      string
	Error    string
	Builtin  bool
	// ContentHash is the folder's current content hash
	// (pluginservice_hash.go), "" for a built-in/invalid plugin -- the
	// signing/tier comparison input.
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
	// PolicyBlocked is the organisation policy's refusal sentence
	// (policy_match.go), "" when no policy refuses this folder. A
	// refused plugin stays listed and never runs.
	PolicyBlocked string
	// Grants names what this plugin was given outside the sandboxed
	// activation frame every other non-built-in plugin runs inside
	// (docs/goals/0375 S1b): "canvas-host" for a non-built-in plugin
	// declaring a canvas object, since the framed canvas API does not
	// exist yet. Always empty for a built-in.
	Grants []string
	// Widened is non-nil for a non-built-in plugin whose manifest
	// declares MORE than its own consent covered (docs/goals/0375 S2,
	// MV3's re-consent-on-widen rule): the NEW elements only, in the
	// shape permissionLines() renders. Nil when narrowed/unchanged,
	// never allowed, or built-in.
	Widened *InstallPreview
}
