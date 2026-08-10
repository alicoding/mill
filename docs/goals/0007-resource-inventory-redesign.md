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
2. [ ] Propose to the owner: default view (row vs card), per-surface
   row anatomy with identity differentiation (entity icon/accent/badge
   vocabulary), redesign-vs-retire for cards mode, and the shared
   inventory component shape (SPEC §3.2's primitive) with migration
   cost.
3. [ ] Implement against the ratified proposal, with e2e; goal 0006's
   trigger labels carry over into whatever row anatomy wins.

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
