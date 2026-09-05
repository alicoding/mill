// The per-spec dedicated e2e server port allocations (goal 0009's own
// pattern, testing.md's "declare it up front" rule): every spec whose
// assertions read GLOBAL app state -- not scoped to entities it creates
// and deletes itself -- gets its own disjoint SERVER_BASE_PORT/
// MCP_BASE_PORT pair here, imported by that spec directly. Split out of
// server.ts at the 500-line hand-written-file limit
// (.claude/rules/architecture.md) -- this file is pure declarations (a
// name, a number, a reasoning comment per pair), server.ts keeps every
// real behavior (spawnMillServer, the worker fixture, health-check
// polling) and re-exports this file's surface so no spec's own import
// statement had to change.

// Port ranges deliberately clear of both Wails' own server-mode default
// (8080) and Mill's own default MCP bind address (127.0.0.1:8090) --
// confirmed live, not assumed: a real LaunchAgent-run mill-server on
// this machine holds localhost:8090 and <tailscale-host>:8080
// permanently, and must never be touched by this suite. Each worker's
// index (Playwright's own `parallelIndex`, stable 0..workers-1 for
// concurrently-running workers, unlike the ever-incrementing
// `workerIndex`) gets one port from each range.
// Exported so server.ts (the worker fixture) can import it back --
// every OTHER export below is also spec-facing, unlike this one.
export const SERVER_BASE_PORT = 9400
// Exported so a spec that needs to talk MCP
// directly -- e.g. canvas-live-sync.spec.ts, driving a real
// update_workflow call against the open editor -- can compute this
// worker's own MCP port (`MCP_BASE_PORT + testInfo.parallelIndex`,
// same arithmetic the workerServer fixture below already uses to spawn
// it) without spawning a second listener of its own.
export const MCP_BASE_PORT = 9500
// A dedicated, disjoint range for the one persistence spec
// (persistence.spec.ts) that deliberately restarts its own server
// against the same settings file mid-test -- never shared with the
// standard per-worker server above, so the two can never collide even
// though both may be alive on the same worker at once.
export const PERSISTENCE_SERVER_BASE_PORT = 9600
export const PERSISTENCE_MCP_BASE_PORT = 9650
// The scale spec's own disjoint range (goal 0073) -- same
// own-server-own-ports reasoning as persistence, since its dense
// fixture env var must never leak into the standard workers' seeds.
export const SCALE_SERVER_BASE_PORT = 9680
export const SCALE_MCP_BASE_PORT = 9730
// The card-page-at-scale spec's own disjoint range (goal 0073 slice
// B) -- same own-server-own-ports reasoning as SCALE_*, since its
// mirror-dense folder-pick override must never leak into the standard
// workers' seeds either.
export const MIRROR_SERVER_BASE_PORT = 9690
export const MIRROR_MCP_BASE_PORT = 9740
// updates.spec.ts's own disjoint pairs (goal 0082, beta pair added
// goal 0100) -- one server per channel, since MILL_TEST_UPDATE_CHANNEL
// is fixed for a process's whole lifetime and every channel's UI needs
// proving in the same run.
export const UPDATES_SOURCE_SERVER_BASE_PORT = 9760
export const UPDATES_SOURCE_MCP_BASE_PORT = 9780
export const UPDATES_RELEASE_SERVER_BASE_PORT = 9790
export const UPDATES_RELEASE_MCP_BASE_PORT = 9810
export const UPDATES_BETA_SERVER_BASE_PORT = 9815
export const UPDATES_BETA_MCP_BASE_PORT = 9825
// The channel-preference opt-in test: persists a store value and
// reloads, so it needs its own server like the other updates cases.
export const UPDATES_CHANNEL_PREF_SERVER_BASE_PORT = 10360
export const UPDATES_CHANNEL_PREF_MCP_BASE_PORT = 10380
// goal 0122: the ready-state pill test forces MILL_TEST_UPDATE_READY
// for its whole server lifetime -- own pair like every updates case.
export const UPDATES_READY_SERVER_BASE_PORT = 10680
export const UPDATES_READY_MCP_BASE_PORT = 10700
// goal 0205 S4: the auto-check-on-open/checking-state/failed-check
// cases each fix MILL_TEST_UPDATE_CHECK_DELAY_MS/MILL_TEST_UPDATE_
// CHECK_FAIL for a whole server lifetime -- own pair like every other
// updates case.
export const UPDATES_AUTOCHECK_SERVER_BASE_PORT = 10760
export const UPDATES_AUTOCHECK_MCP_BASE_PORT = 10780
// atlas-kind-authoring.spec.ts's own dedicated pair (goal 0079):
// kinds/link kinds are GLOBAL Atlas vocabulary every board render and
// picker reads -- the shared worker pool can't isolate that
// (testing.md's shared-vs-dedicated rule).
export const ATLAS_KIND_AUTHORING_SERVER_BASE_PORT = 10400
export const ATLAS_KIND_AUTHORING_MCP_BASE_PORT = 10420
// guardrail-authoring.spec.ts's own dedicated pair (goal 0078): the
// full rule-from-park -> unstick -> audit-edit -> policy-removed loop
// asserts exact rule counts/groupings in the Rules audit view, which
// the standard per-worker pool can't guarantee stays uncontaminated by
// another spec file sharing that worker's one server -- same
// own-server-own-ports reasoning as persistence/scale/mirror above.
export const GUARDRAIL_AUTHORING_SERVER_BASE_PORT = 9840
export const GUARDRAIL_AUTHORING_MCP_BASE_PORT = 9860

// atlas-authoring.spec.ts's own dedicated pair (goal 0081 slice A1):
// creates/deletes cards and notes in the seeded space and asserts
// exact card/note presence and projection counts, same own-server-
// own-ports reasoning as guardrail-authoring above.
export const ATLAS_AUTHORING_SERVER_BASE_PORT = 9880
export const ATLAS_AUTHORING_MCP_BASE_PORT = 9900
// atlas-containment.spec.ts's own dedicated pair (goal 0081 slice A2):
// draws/groups areas and drags cards between frames in the seeded
// space, asserting exact frame child counts -- same own-server-own-
// ports reasoning as atlas-authoring above, disjoint from it so the
// two spec files' own card/frame counts never cross-contaminate.
export const ATLAS_CONTAINMENT_SERVER_BASE_PORT = 9920
export const ATLAS_CONTAINMENT_MCP_BASE_PORT = 9940

// atlas-slots.spec.ts's own dedicated pair (goal 0081 slice A4): drags
// slot anchors, creates/removes links, and asserts exact link counts
// per card -- same own-server-own-ports reasoning as atlas-authoring/
// atlas-containment above, disjoint from both.
export const ATLAS_SLOTS_SERVER_BASE_PORT = 9960
export const ATLAS_SLOTS_MCP_BASE_PORT = 9980

// atlas-page-edit.spec.ts's own dedicated pair (goal 0081 slice A5):
// edits fields in place, adds/removes links via the page's own slot
// rows, and asserts exact link/chip counts and nav-stack state --
// same own-server-own-ports reasoning as atlas-slots above, disjoint
// from it.
export const ATLAS_PAGE_EDIT_SERVER_BASE_PORT = 10000
export const ATLAS_PAGE_EDIT_MCP_BASE_PORT = 10020

// atlas-select-group.spec.ts: its own file (and therefore worker) --
// the select-then-group flow proved green in single-worker runs and
// red sharing a worker with the containment spec's heavy gestures.
export const ATLAS_SELECT_GROUP_SERVER_BASE_PORT = 10060
export const ATLAS_SELECT_GROUP_MCP_BASE_PORT = 10080

// atlas-session-restore.spec.ts's own dedicated pair (goal 0091): the
// one spec that needs restore-on-mount LIVE (the worker pool suppresses
// it via MILL_TEST_ATLAS_SESSION_OFF above), reload-based within one
// test -- same own-server-own-ports reasoning as persistence.
export const ATLAS_SESSION_SERVER_BASE_PORT = 10100
export const ATLAS_SESSION_MCP_BASE_PORT = 10120

// guardrail.spec.ts's own dedicated pair: its Review-queue assertions
// (exact pending/resolved rows, kind-filter narrowing, the sidebar
// pending-count badge) must never be contaminated by another spec
// cohabiting the standard per-worker pool's one shared server (e.g.
// mcp-write-cancel.spec.ts parking its own MCP approval on the same
// worker) -- same own-server-own-ports reasoning as guardrail-
// authoring above, one class of bug applied to this file's own
// Review-queue state.
export const GUARDRAIL_SPEC_SERVER_BASE_PORT = 10140
export const GUARDRAIL_SPEC_MCP_BASE_PORT = 10160

// guardrail-review.spec.ts's own dedicated pair -- guardrail.spec.ts's
// Review-queue tests split into this second file once the converted
// file crossed the 500-line hand-written-file limit
// (.claude/rules/architecture.md); its own port pair rather than
// reusing GUARDRAIL_SPEC_* above, so the two files' worker-time
// lifetimes can never overlap on the same ports even though same-file/
// same-worker serialization no longer makes that a correctness risk.
export const GUARDRAIL_REVIEW_SERVER_BASE_PORT = 10180
// Kept well clear of the server range above: 8 tests x up to 10-per-
// test offsets x up to 4 workers pushes the server range itself past
// 10250, so the MCP base must start beyond that or a computed server
// port can land on another test's MCP listener.
export const GUARDRAIL_REVIEW_MCP_BASE_PORT = 10300

// atlas-perspectives.spec.ts's own dedicated pair (goal 0095 slice 2,
// ADR-0041): the active perspective is GLOBAL Atlas session state
// (AtlasSessionState.activePerspectiveID), and its own perspective/
// membership records are read by every other Atlas spec's board --
// same shared-global-state reasoning as guardrail-authoring/
// atlas-session-restore above, applied to this feature's own writes.
export const ATLAS_PERSPECTIVES_SERVER_BASE_PORT = 10320
export const ATLAS_PERSPECTIVES_MCP_BASE_PORT = 10340

// atlas-linking.spec.ts's own dedicated pair (goal 0124 slice 2):
// drags links between cards and asserts exact edge counts, same
// own-server-own-ports reasoning as atlas-slots above.
export const ATLAS_LINKING_SERVER_BASE_PORT = 10440
export const ATLAS_LINKING_MCP_BASE_PORT = 10460

// atlas-delivery-ledger.spec.ts's own dedicated pair (goal 0164 L1):
// edits the seeded ledger-sync workflow's own folderPath config
// (global, shared-workflow state per composition's own model) and
// creates real Atlas cards from a fixture folder, same own-server-
// own-ports reasoning as atlas-linking above.
export const ATLAS_LEDGER_SYNC_SERVER_BASE_PORT = 10480
export const ATLAS_LEDGER_SYNC_MCP_BASE_PORT = 10500

// atlas-folder-import-kind-proposal.spec.ts's own dedicated pair (goal
// 0172 S2): its own MILL_TEST_FOLDER_PICK_PATH override points at a
// frontmatter-carrying fixture folder distinct from the shared pool's
// synced-folder/ (which the standard worker fixture already commits
// every OTHER folder-import spec to) -- same own-server-own-ports
// reasoning as atlas-delivery-ledger above.
export const KIND_PROPOSAL_SERVER_BASE_PORT = 10520
export const KIND_PROPOSAL_MCP_BASE_PORT = 10540

// atlas-single-space-trap.spec.ts's own dedicated pair (goal 0183):
// deletes the seeded root card down to ZERO spaces and back up, a
// global root-card-count state every other Atlas spec in the shared
// pool assumes never happens (they all rely on auto-entering the one
// seeded root, "The engagement", on every fresh load) -- same
// own-server-own-ports reasoning as atlas-session-restore above.
export const ATLAS_SINGLE_SPACE_SERVER_BASE_PORT = 10560
export const ATLAS_SINGLE_SPACE_MCP_BASE_PORT = 10580

// secrets.spec.ts's own dedicated pair (goal 0185 S2): vault existence/
// lock state is GLOBAL app state (testing.md's shared-vs-dedicated
// rule) -- a shared-pool server could be mid-setup or mid-unlock from
// another spec cohabiting the same worker.
export const SECRETS_SERVER_BASE_PORT = 10720
export const SECRETS_MCP_BASE_PORT = 10740

// updates.spec.ts's auto-download-live-toggle case (goal 0207): fixes
// MILL_TEST_AUTO_UPDATE_LOOP_DELAY_MS/MILL_TEST_UPDATE_DOWNLOAD_DELAY_MS
// for its whole server lifetime -- own pair like every other updates
// case above.
export const UPDATES_AUTODOWNLOAD_SERVER_BASE_PORT = 10800
export const UPDATES_AUTODOWNLOAD_MCP_BASE_PORT = 10820

// atlas-roadmap-empty-state.spec.ts (goal 0225): the picker's
// auto-declare path writes a new Field onto a Kind, global vocabulary
// every board render and picker reads -- same reasoning as
// ATLAS_KIND_AUTHORING_*'s own dedicated pair above.
export const ATLAS_ROADMAP_EMPTY_STATE_SERVER_BASE_PORT = 10840
export const ATLAS_ROADMAP_EMPTY_STATE_MCP_BASE_PORT = 10860

// updates.spec.ts's pill-acts case (goal 0220 S1): fixes MILL_TEST_
// UPDATE_DOWNLOAD_DELAY_MS to observe the pill's own downloading phase
// deterministically after a real click -- own pair like every other
// updates case above.
export const UPDATES_PILL_ACTION_SERVER_BASE_PORT = 10880
export const UPDATES_PILL_ACTION_MCP_BASE_PORT = 10900

// quick-panel-update.spec.ts (goal 0222 S2): fixes MILL_TEST_UPDATE_*
// for its whole server lifetime, same reasoning as every other updates
// case above -- proves the Quick Panel's own quickPanel-derived
// download row appears live, not just the pill/Settings surfaces
// updates-live-actions.spec.ts already covers.
export const UPDATES_QUICK_PANEL_SERVER_BASE_PORT = 10920
export const UPDATES_QUICK_PANEL_MCP_BASE_PORT = 10940

// updates.spec.ts's "What's new" empty-state case (goal 0220 S2): no
// MILL_TEST_UPDATE_FAKE_VERSION, so opening Settings would fire a real
// (offline-failing) network check -- this test only ever opens the
// dialog via the palette, never visits Settings, own pair regardless.
export const UPDATES_WHATSNEW_EMPTY_SERVER_BASE_PORT = 10960
export const UPDATES_WHATSNEW_EMPTY_MCP_BASE_PORT = 10980

// updates.spec.ts's "What's new" notes case (goal 0220 S2): fixes
// MILL_TEST_UPDATE_FAKE_VERSION for its whole server lifetime, same
// reasoning as every other updates case above -- proves the pill's
// secondary link and Settings' own link converge on the identical
// rendered notes.
export const UPDATES_WHATSNEW_NOTES_SERVER_BASE_PORT = 11000
export const UPDATES_WHATSNEW_NOTES_MCP_BASE_PORT = 11020

// clipboard-history.spec.ts (goal 0234): dedicated, same reasoning as
// SECRETS_SERVER_BASE_PORT above -- Clipboard history's own entry list
// is GLOBAL app state (testing.md's shared-vs-dedicated rule), and this
// spec also asserts the true EMPTY state, which needs a guaranteed-
// fresh settings file no other spec could have already written into.
export const CLIPBOARD_HISTORY_SERVER_BASE_PORT = 11040
export const CLIPBOARD_HISTORY_MCP_BASE_PORT = 11060

// coding-loop-secrets.spec.ts (goal 0240 S2): dedicated, same reasoning
// as SECRETS_SERVER_BASE_PORT above -- this spec creates a real vault
// entry, and vault existence/lock state is GLOBAL app state the shared
// worker pool coding-loop.spec.ts itself runs on must never see.
export const CODING_LOOP_SECRETS_SERVER_BASE_PORT = 11080
export const CODING_LOOP_SECRETS_MCP_BASE_PORT = 11100

// runtime-plugins.spec.ts's own dedicated pair (goal 0249): its server
// boots with MILL_PLUGINS_DIR pointed at the repo's own
// examples/plugins fixture, a whole-process env the shared pool must
// never inherit, and its Review-queue assertions read the global
// pending-guarded-action list.
export const RUNTIME_PLUGINS_SERVER_BASE_PORT = 11120
export const RUNTIME_PLUGINS_MCP_BASE_PORT = 11140

// tray-panel.spec.ts's own dedicated pair (goal 0189): its assertions
// read the GLOBAL run/pending queues (exact empty states, a parked
// run's row), which a shared worker's cohabiting specs would
// contaminate.
export const TRAY_PANEL_SERVER_BASE_PORT = 11160
export const TRAY_PANEL_MCP_BASE_PORT = 11180

// updates-user-check.spec.ts's own dedicated pairs (goal 0275): each
// test needs a fixed MILL_TEST_UPDATE_* env for its whole lifetime,
// same reasoning as every UPDATES_* pair above.
export const UPDATES_USERCHECK_UPTODATE_SERVER_BASE_PORT = 11200
export const UPDATES_USERCHECK_UPTODATE_MCP_BASE_PORT = 11220
export const UPDATES_USERCHECK_FAIL_SERVER_BASE_PORT = 11240
export const UPDATES_USERCHECK_FAIL_MCP_BASE_PORT = 11260

// runtime-plugin-reload.spec.ts's own dedicated pair (goal 0319): the
// runtime-plugins offsets are 20 apart, so offset o's server port is
// offset o-20's MCP port -- that space is nearly full and every new
// offset has to be checked against both directions. A pair of its own,
// clear of every family above, ends that arithmetic for this spec.
export const RUNTIME_PLUGIN_RELOAD_SERVER_BASE_PORT = 11280
export const RUNTIME_PLUGIN_RELOAD_MCP_BASE_PORT = 11300

// runtime-plugin-mcp.spec.ts's own dedicated pair (goal 0324): it
// drives the real MCP transport against a server whose plugins dir is
// its own copy, and its assertions read the GLOBAL tool list -- which
// every other spec's plugins would change. Offsets 0/2/4 within it,
// same shape as RUNTIME_PLUGIN_RELOAD_* above.
export const RUNTIME_PLUGIN_MCP_SERVER_BASE_PORT = 11320
export const RUNTIME_PLUGIN_MCP_MCP_BASE_PORT = 11340

// guardrail-review.spec.ts's stop-from-the-run-detail badge case (goal
// 0329): GUARDRAIL_REVIEW_*'s own offsets are nearly exhausted -- its
// MCP base (10300) plus another 10-offset lands inside the
// ATLAS_PERSPECTIVES_*/UPDATES_CHANNEL_PREF_* ranges above. A pair of
// its own, clear of every family, rather than more offset arithmetic
// (the same reasoning RUNTIME_PLUGIN_RELOAD_* records).
export const GUARDRAIL_REVIEW_CANCEL_SERVER_BASE_PORT = 11360
export const GUARDRAIL_REVIEW_CANCEL_MCP_BASE_PORT = 11380

// review-resolved-history.spec.ts's own dedicated pair (goal 0337 S2):
// proves the resolved-history section's own toolbar/count/pagination
// against a queue of resolved runs it seeds itself -- global Review
// state (testing.md's shared-vs-dedicated rule), same reasoning as
// every GUARDRAIL_REVIEW_* pair above.
export const REVIEW_RESOLVED_HISTORY_SERVER_BASE_PORT = 11400
export const REVIEW_RESOLVED_HISTORY_MCP_BASE_PORT = 11420

// settings-extensions-list.spec.ts's own dedicated pair (goal 0337
// S2): the installed-plugins list reads the GLOBAL PluginService.
// ListPlugins() response, and this spec boots with its own
// MILL_PLUGINS_DIR copy (fixtures/runtimePlugins.ts's launchWithPlugins)
// like every runtime-plugin spec above.
export const SETTINGS_EXTENSIONS_LIST_SERVER_BASE_PORT = 11440
export const SETTINGS_EXTENSIONS_LIST_MCP_BASE_PORT = 11460

// review-open-run.spec.ts's own dedicated pair (goal 0343): the
// "Open run" door out of a pending Review item reads the GLOBAL
// pending queue -- exactly the state testing.md's shared-vs-dedicated
// rule keeps off the shared pool, same reasoning as every
// GUARDRAIL_REVIEW_* pair above.
export const REVIEW_OPEN_RUN_SERVER_BASE_PORT = 11480
export const REVIEW_OPEN_RUN_MCP_BASE_PORT = 11500

// paused-runs.spec.ts's own dedicated pair (goal 0328): a step-mode
// pause must be absent from the GLOBAL Review queue and its badge, and
// present on the GLOBAL Activity runs list -- both exactly the
// cross-spec state testing.md's shared-vs-dedicated rule keeps off the
// shared pool, same reasoning as every GUARDRAIL_REVIEW_* pair above.
export const PAUSED_RUNS_SERVER_BASE_PORT = 11520
export const PAUSED_RUNS_MCP_BASE_PORT = 11540

// guardrail-review.spec.ts's parked-payload case (goal 0326): parking a
// run puts an item in the GLOBAL Review queue, exactly the state
// testing.md's shared-vs-dedicated rule keeps off the shared pool. Its
// own pair rather than another GUARDRAIL_REVIEW_* offset, whose range
// is already nearly exhausted (see GUARDRAIL_REVIEW_CANCEL_* above).
export const REVIEW_PARKED_PAYLOAD_SERVER_BASE_PORT = 11560
export const REVIEW_PARKED_PAYLOAD_MCP_BASE_PORT = 11580

// secret-source-plugins.spec.ts (goal 0306 S4): a dedicated server whose
// plugins dir carries the Netrc example, so the Sources page can offer
// an extension-contributed kind. Its own base pair rather than an
// offset into the runtime-plugins family, whose offsets are dense
// enough that a new one would collide with another's MCP port.
export const SECRET_SOURCE_PLUGIN_SERVER_BASE_PORT = 11600
export const SECRET_SOURCE_PLUGIN_MCP_BASE_PORT = 11620

// runtime-plugin-themes.spec.ts (goal 0348 follow-up): installs and
// allows a fixture plugin at runtime, which writes into MILL_PLUGINS_DIR
// and the plugin trust allow-list -- both process-wide/global state
// testing.md's shared-vs-dedicated rule keeps off the shared pool, the
// same reasoning every other runtime-plugin-*.spec.ts pair above
// records.
export const RUNTIME_PLUGIN_THEMES_SERVER_BASE_PORT = 11640
export const RUNTIME_PLUGIN_THEMES_MCP_BASE_PORT = 11660

// runtime-plugin-view-frame.spec.ts's own dedicated pair (goal 0349):
// it boots with its own MILL_PLUGINS_DIR copy like every runtime-plugin
// spec, and its notice-pill assertions read the GLOBAL notice list --
// its own pair rather than more RUNTIME_PLUGINS_* offset arithmetic
// (the reasoning RUNTIME_PLUGIN_RELOAD_* records).
export const RUNTIME_PLUGIN_FRAME_SERVER_BASE_PORT = 11680
export const RUNTIME_PLUGIN_FRAME_MCP_BASE_PORT = 11700

// browser-bridge.spec.ts's own dedicated pair (goal 0350 S1): the
// paired-BROWSER list and the bridge's connected count are GLOBAL app
// state (testing.md's shared-vs-dedicated rule), and this spec pairs
// and revokes against them.
export const BROWSER_BRIDGE_SERVER_BASE_PORT = 11720
export const BROWSER_BRIDGE_MCP_BASE_PORT = 11740

// clipboard-bridge.spec.ts's own dedicated pair (goal 0356): every test
// in this file writes to the real OS pasteboard (fixtures/
// hostClipboard.ts's pbcopy door) and reads it back through
// CompositionService.ReadHostClipboardText, so the file needs
// MILL_CLIPBOARD=host -- the standard per-worker pool defaults to the
// in-memory adapter and can't be overridden per-spec.
export const CLIPBOARD_BRIDGE_SERVER_BASE_PORT = 11760
export const CLIPBOARD_BRIDGE_MCP_BASE_PORT = 11780

// coding-loop.spec.ts's own dedicated pair (goal 0356): same
// MILL_CLIPBOARD=host reasoning as CLIPBOARD_BRIDGE_* above -- every
// test seeds a captured command via the real pasteboard.
export const CODING_LOOP_SERVER_BASE_PORT = 11800
export const CODING_LOOP_MCP_BASE_PORT = 11820

// quick-panel-clipboard-apply.spec.ts's own dedicated pair (goal 0356):
// same MILL_CLIPBOARD=host reasoning as CLIPBOARD_BRIDGE_* above --
// every test applies a real pasteboard payload via the Quick Panel.
export const QUICK_PANEL_CLIPBOARD_APPLY_SERVER_BASE_PORT = 11840
export const QUICK_PANEL_CLIPBOARD_APPLY_MCP_BASE_PORT = 11860

// atlas-image-tool-host-paste.spec.ts's own dedicated pair (goal 0356):
// split out of atlas-image-tool.spec.ts, whose other tests stay on the
// shared pool -- only its screenshot-bitmap-fallback case needs
// MILL_CLIPBOARD=host, to prove the window paste door's real host
// file-url read (not the in-memory adapter's always-empty one).
export const ATLAS_IMAGE_TOOL_HOST_PASTE_SERVER_BASE_PORT = 11880
export const ATLAS_IMAGE_TOOL_HOST_PASTE_MCP_BASE_PORT = 11900

// atlas-image-export-host-copy.spec.ts's own dedicated pair (goal
// 0356): split out of atlas-image-export.spec.ts, whose other tests
// stay on the shared pool -- only its "copying says what landed on the
// clipboard" case needs MILL_CLIPBOARD=host, since its assertion
// branches on real host-pasteboard availability (WritePNG must fail on
// a runner with no real pasteboard, which the in-memory adapter never
// does).
export const ATLAS_IMAGE_EXPORT_HOST_COPY_SERVER_BASE_PORT = 11920
export const ATLAS_IMAGE_EXPORT_HOST_COPY_MCP_BASE_PORT = 11940

// Every spawned server binds a browser-bridge listener too, derived
// from its own server port by this offset rather than declared per
// spec: a bridge port is needed by EVERY server (the service starts
// unconditionally), so a per-spec declaration would have to be added to
// all of them and could never be forgotten safely. The offset is large
// enough to clear the whole declared range above with room to spare, so
// no derived bridge port can land on another spec's declared listener.
export const BRIDGE_PORT_OFFSET = 20000

// The Extensions store's own dedicated pair (goal 0349): browsing,
// adding a marketplace source and installing all change GLOBAL plugin
// state -- what the plugins directory holds and which marketplaces
// this Mill reads -- exactly the cross-spec state testing.md's
// shared-vs-dedicated rule keeps off the shared pool.
export const EXTENSIONS_STORE_SERVER_BASE_PORT = 11760
export const EXTENSIONS_STORE_MCP_BASE_PORT = 11780

// extensions-install.spec.ts's own pair (goal 0349): the archive
// install path writes into the plugins directory, the same global
// state the store spec's pair isolates.
export const EXTENSIONS_INSTALL_SERVER_BASE_PORT = 11800
export const EXTENSIONS_INSTALL_MCP_BASE_PORT = 11820
