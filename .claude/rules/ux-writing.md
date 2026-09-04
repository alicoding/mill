# UX writing — product copy, not spec narrative

No `paths` frontmatter — copy shows up in locale JSON, seeded entity
descriptions, and component fallbacks, so this loads unconditionally
like architecture.md.

UI copy tells the user what they can do and what happens next, in their
vocabulary — never the system's internals. The bar is converged industry
convention (Material Design, Apple HIG, Nielsen Norman Group microcopy):

- **Front-load the action or outcome** — verb or benefit first,
  qualifiers after, if at all.
- **One idea per sentence; one sentence per caption.** A subtitle is one
  sentence; a field caption ≤ ~100 characters. A concept needing a
  paragraph needs progressive disclosure, not a longer caption.
- **Never reference internal documents.** `docs/…` paths, ADR ids, goal
  files, § symbols mean nothing inside the app. State only the behavior.
  (Enforced for locale files: `scripts/check-ui-copy.sh`, `ui-copy` job.)
- **Never explain by naming other products** — describe what the feature
  does instead of comparing it to a competitor. Review-checked, not
  grep-gated.
- **No spec-asides.** A dash clause justifying the design is
  documentation — state the rule the user experiences (gated:
  `check-ui-copy.sh`).
- **Present tense, sentence case, second person implied.** "Runs every
  minute", not "This workflow will be run every minute".
- **An empty state offers the action it names** — ship the button/
  picker/door in the same view, or change the sentence.

The test, mirroring comments.md's: read the string as a first-time user
with no repo access — every clause they couldn't act on is spec
narrative, not copy.
