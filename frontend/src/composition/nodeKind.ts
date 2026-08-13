import { CheckCircleIcon, DownloadIcon, GitBranchIcon, SyncIcon, UploadIcon, ZapIcon, type Icon } from '@primer/octicons-react'

// Shared by CompositionCanvas.tsx (canvas node chrome, palette) and
// CompositionView.tsx (node-primitives list, saved-workflow chip chain)
// -- split into its own module rather than co-located with a component
// so Fast Refresh doesn't warn about a non-component export.
//
// Mill's node kinds are Capture/Process/Apply/Trigger/Decision(routing)/
// Terminal (SPEC.md §2/§3.4/§3.5, docs/adr/0027), not the reference
// no-code platform's fuller Input/Ruleset/... taxonomy (SPEC.md
// §3.2/ADR-0005) -- most of that fuller taxonomy is still real, unbuilt
// future work (Ruleset/Parallel Steps/etc. don't exist in Mill yet), so
// the icon/color/title-case treatment below is adopted from that
// reference's card style, but applied honestly to what Mill's nodes
// actually do, not borrowed names for capabilities Mill doesn't have.
//
// ADR-0027 relabels the UI vocabulary: the routing kind (code identifier
// `decision`, unchanged) reads "Branch" everywhere in the UI; "Decision"
// as a user-facing noun now names the new `terminal` kind instead --
// same code-vs-UI naming split ADR-0016 already established (e.g.
// HTTPRequest's Integration umbrella term).

export const KIND_LABEL: Record<string, string> = {
  trigger: 'Trigger',
  capture: 'Capture',
  process: 'Process',
  apply: 'Apply',
  decision: 'Branch',
  terminal: 'Decision',
}

// ZapIcon for Trigger matches the bolt-icon convention n8n itself uses to
// mark trigger nodes in its own palette (confirmed via docs.n8n.io, see
// SPEC.md §3.4) -- not invented. DownloadIcon/SyncIcon/UploadIcon: capture
// pulls data in, process transforms it in place, apply pushes it back out
// -- the same in/transform/out shape the reference's own Input icon
// (arrow into a box) gestures at, expressed with icons that already exist
// in Mill's adopted icon set (@primer/octicons-react, no new dependency).
// GitBranchIcon for Branch (routing): a point with multiple named
// outgoing paths is exactly what a branch is a visual metaphor for.
// CheckCircleIcon for Decision (terminal, ADR-0027): a workflow ending
// at a settled outcome -- distinct from Branch's still-in-flight
// routing icon.
export const KIND_ICON: Record<string, Icon> = {
  trigger: ZapIcon,
  capture: DownloadIcon,
  process: SyncIcon,
  apply: UploadIcon,
  decision: GitBranchIcon,
  terminal: CheckCircleIcon,
}

// design wave 2 (goal 0001): fixed to Mill's own --mill-kind-* custom
// properties (app/index.css) instead of Primer's shared semantic
// tokens (--bgColor-success-emphasis etc.) -- those are also what
// StatusStamp's variants render with, so aliasing them here made a
// node's identity color and a status pill's meaning collide on the
// same card (the audit's "green triple duty" finding). See
// index.css's own comment for the token values and contrast checks.
export const KIND_ICON_BG: Record<string, string> = {
  trigger: 'var(--mill-kind-trigger)',
  capture: 'var(--mill-kind-capture)',
  process: 'var(--mill-kind-process)',
  apply: 'var(--mill-kind-apply)',
  decision: 'var(--mill-kind-decision)',
  terminal: 'var(--mill-kind-terminal)',
}
