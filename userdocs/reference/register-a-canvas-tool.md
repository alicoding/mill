# Register a canvas tool

A walkthrough of adding a new placeable tool to Atlas, using Mill's own
simplest real one — `card` — as the worked example. Read "Extending the
canvas" first for the full field-by-field contract this guide only
walks through in order; that page's table is the reference, this one is
the tutorial.

## 1. Pick a stable id

Every tool needs an id already declared in
`frontend/src/shared/atlasToolIdentity.ts`'s `ATLAS_TOOL_IDENTITIES`
array — this is where the id, its command label key, its bare-key shortcut
(if any), and its authoring gesture (`interaction`) live, shared by both
the tool file and the identity-agreement check that fails the build if
the two ever disagree.

## 2. Write one file

`frontend/src/atlas/tools/<id>Tool.ts` builds an object matching
`AtlasToolShape` and calls `registerNoun(...)` on it at module scope.
Below is Mill's own card tool, quoted whole — every declaration field
`AtlasToolShape` requires, answered honestly (`false`/`null`/`[]` where
a field doesn't apply, never omitted):

<!-- BEGIN GENERATED: frontend/src/atlas/tools/cardTool.ts -->

```ts
import { FileIcon } from '@primer/octicons-react'
import type { Kind } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { lastUsedKindID } from '../atlasCreateHelpers'

const cardIdentity = identityOf('card')

export interface AtlasCardArtifact { kind: 'card'; kindID: string; title: string; note: string }

// Card's instant-placement default (goal 0144: the click IS the
// creation, no form) resolves the last-used kind itself; a form-driven
// create (right-click "Add card", paste, slot-link) instead supplies
// kindID/title explicitly and this just shapes them into the same
// artifact -- one function backs both placement doors.
export const cardTool = {
  id: cardIdentity.id,
  icon: FileIcon,
  label: cardIdentity.commandLabel,
  nounName: 'atlas:cardNoun.name',
  description: 'atlas:cardNoun.description',
  shortcutKey: cardIdentity.shortcutKey,
  tray: 'quick',
  // The atom -- typed, linked, filed, searchable knowledge (goal 0224's
  // disposition table), tray-primary.
  group: 'knowledge',
  interaction: cardIdentity.interaction,
  // Instant placement (goal 0144) always disarms after the one click --
  // never reads a lock flag at all, so this stays false rather than N/A.
  lockable: false,
  // Rendered by AtlasNoteCardNode ('atlas-note'), whose own NodeResizer
  // is the general card resize (goal 0193).
  resizable: true,
  boardNodeType: 'atlas-note',
  // Not routed through the shared 'atlas-object' renderer -- always
  // false, not N/A (atlasNounRegistry.ts's own header comment).
  dragBand: false,
  // No boardObjectKind means no content registration reads this at
  // all -- always false, not N/A.
  fileBacked: false,
  // Rendered by AtlasNoteCardNode, not the shared 'atlas-object'
  // content contract -- always null, not N/A.
  boardObjectKind: null,
  content: null,
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Never drags -- placed by a single click (useAtlasCreation.ts's
  // placeAt), so this is never read at all; false, not N/A.
  sticky: false,
  gesture: null,
  commit: (input: { kinds: Kind[]; kindID?: string; title?: string; note?: string }): AtlasCardArtifact => ({
    kind: 'card',
    kindID: input.kindID ?? lastUsedKindID(input.kinds),
    title: input.title ?? 'Untitled',
    note: input.note ?? '',
  }),
} as const satisfies AtlasToolShape

registerNoun(cardTool)

```

<!-- END GENERATED -->

`commit` is the one field on this shape that's runtime code, not inert
data — it shapes the placement input into the artifact the board
persists. Everything else here is read before any of this tool's own
code runs.

## 3. Nothing else to wire

`frontend/src/atlas/atlasTools.ts` discovers `tools/*.ts` by glob, so
there is no registry array to append to by hand. Add a translated
string file at `frontend/src/locales/en/atlas/<id>.json` if the tool
needs its own copy.

## 4. Satisfy the conformance suite

Run the frontend tests. A new tool has to keep
`atlasNounDeclarationFields.test.ts`, `atlasArmConformance.test.ts`,
`atlasBoardSurfaceConformance.test.ts`,
`atlasEditorBoundsConformance.test.ts`, and
`atlasSelectionRingConformance.test.ts` passing — see "Extending the
canvas" for what each one actually checks. None of them render
anything; they read your declaration and the live registry as data.
