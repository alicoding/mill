# UX writing — product copy, not spec narrative

No `paths` frontmatter — loads unconditionally like architecture.md.

UI copy tells the user what they can do and what happens next, in their
vocabulary — never the system's internals. The bar is converged industry
convention (Material Design, Apple HIG, Nielsen Norman Group microcopy):

- **Front-load the action or outcome** — verb or benefit first,
  qualifiers after, if at all.
- **One idea per sentence; one sentence per caption.** A subtitle is one
  sentence; a field caption ≤ ~100 characters. A concept needing a
  paragraph needs progressive disclosure, not a longer caption.
- **Every user-facing string is a locale key.** In a component that is
  `t()`; outside one, `shared/copy.ts`'s `copy()` resolves the same key.
  A sentence inline in `.ts`/`.tsx` fails `i18next/no-literal-string`
  and `check-ui-copy.sh`.
- **Never reference internal documents.** `docs/…` paths, ADR ids, goal
  files, § symbols mean nothing inside the app. State only the behavior.
- **Never name another product to explain a feature.** Review-checked.
- **No spec-asides.** A dash clause justifying the design is
  documentation — state the rule the user experiences (gated:
  `check-ui-copy.sh`).
- **Present tense, sentence case, second person implied.** "Runs every
  minute", not "This workflow will be run every minute".
- **An empty state offers the action it names** — ship the button or
  picker in the same view, or change the sentence.

The test, mirroring comments.md's: read the string as a first-time user
with no repo access — every clause they couldn't act on is spec
narrative, not copy.
