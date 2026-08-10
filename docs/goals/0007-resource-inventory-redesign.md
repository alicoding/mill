# 0007 — Resource-inventory redesign: one identity-differentiated list pattern

## Goal
Owner critique (2026-08-10, live, verbatim in spirit): the Workflows
page and Configure → Integrations page "look and feel the same," to
the point of editing confusion (thought they were on the workflow
page while on integrations); and the fat-card view itself is disliked
("I don't really like our card view — can we research a better
pattern?"). Two distinct problems, one design surface:

1. **Page identity** — every inventory renders as white cards with
   title + badges + description + chip row + top-right icon cluster;
   nothing announces the entity type. Workflow step chips and
   integration auth badges even share the same Label component, so
   different vocabularies read as one visual grammar. Cards also lead
   with raw `ID: …` noise.
2. **The card pattern itself** — accreted, not designed. SPEC §3.2's
   recorded primitives already name the reference platform's own
   answer: a shared **resource-inventory table** (search,
   name-as-link, status badge, sort-by-updated, one primary create
   action, row-click opens) — compact identity-dense rows, not prose
   cards.

## Plan
1. [ ] Research (in flight): n8n/Zapier/Linear/GitHub inventory row
   anatomy; page-identity differentiation mechanisms; cards-vs-rows
   guidance (Primer's own docs, NN/g); installed Primer's actual
   building blocks; full Mill-internal audit of the seven-ish
   surfaces sharing this shape.
2. [~] Proposal round one (2026-08-10) — research found: no comparable
   product (n8n/GitHub/Linear, all primary-sourced) uses cards for
   homogeneous inventories; Mill's cards-by-default is viewMode.ts's
   own default value; installed Primer's ActionList natively provides
   leading icons/inline truncated descriptions/trailing actions/
   clickable rows (Mill only ever used it inside dropdowns); Mill
   already owns the icon vocabulary (navIcon.ts, nodeKind.ts) but
   never applied it to rows; GitLab #4005 is the direct one-row-
   component-across-contexts precedent; Blankslate exists, unused —
   empty states are bare muted paragraphs. **Owner ratified:** dense
   ActionList-based shared rows as the DEFAULT for all five
   inventories (per-entity leading icon + badges + one truncated
   description + trailing actions); DataTable stays the SECONDARY
   toggle view (sorting/resizable preserved; §3.2's primitive is
   literally a table). **Cards verdict, resolved by owner-supplied
   screenshots of the reference platform's real inventories
   (2026-08-10): RETIRED.** The reference has nothing card-shaped:
   its Inputs inventory is a pure compact table (leading type icon +
   name, cross-entity *reference chips* — icon + name + version
   pill — updated-by, timestamp, search, one primary create,
   pagination), and its Workflows view toggle is flat-list vs
   **grouped-by-workflow versions** (the "card"-looking container is
   a version-management group holding per-version rows: vN Live
   100% / Draft) — a different data shape, not a card restyle. Two
   patterns adopted into the row anatomy from this: reference chips
   for cross-entity links (trigger labels, Decision/Integration
   references), and the Live/Draft status-pill vocabulary. The
   grouped-versions view itself is recorded as future design input
   (valuable once real version history accumulates; today Versions
   lives in the editor tab), not built now.
3. [x] Implemented (2026-08-10): `shared/InventoryList.tsx` +
   `entityIcons.ts`; five call-site swaps; `WorkflowsCards.tsx` and
   all cards branches deleted; rows default with legacy-'cards'
   localStorage migration; search + Blankslate everywhere; trigger
   labels carried in; 26 spec files migrated. Two real Primer
   internals fixed en route (TrailingVisual's unconditional
   pointer-events:none ate every Run/kebab click — diagnosed via
   elementFromPoint; role="list" required so nested buttons stay
   valid HTML). Final verification: 110/110 on a clean fixture
   baseline (contamination from the mid-build broken-click era was
   cleared and the three masked spec defects fixed, not explained
   away). Owner's live recognition test = the acceptance gate.

## Follow-up (owner-raised 2026-08-10, not built)
Pagination: no Mill list paginates today. Inventories render all rows
(fine at current scale; search covers finding; add rows-per-page to
the shared InventoryList when a real dataset warrants — the reference
platform's own inventories paginate, recorded in §3.2). The one
place truncation already silently happens: run-history lists cap at
50 server-side (`ListRuns`'s `WithFilterLimit(50)`) with no
indicator — fix alongside goal 0011's row tables (which genuinely
need pagination) or whenever run volume makes it real; at minimum an
"showing latest 50" indicator is honest and cheap.

## Acceptance
Owner's own bar, stated directly (2026-08-10): "you want to feel like
you are used to the page style — when you go to it you don't need to
confirm that you are on that page." **Recognition, not confirmation**:
each surface identifiable from ambient cues (shape/density/accent/
iconography) before reading any text. Concretely: owner opens
Workflows and Integrations back-to-back and never mistakes one for
the other; the list surfaces read as one designed system with
per-entity identity; the card-view dislike is resolved (redesigned or
retired, their call).
