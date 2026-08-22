import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The frontend half of atlassvc's own TestAtlasNoHardcodedConcepts
// tripwire (internal/services/atlassvc/atlasservice_nohardcode_test.go)
// -- ADR-0038 Decision 2 requires every card-kind/link-kind NAME to
// live only in a seed file, and that requirement covers frontend/src/
// atlas/** exactly as much as the Go domain package. Same limits as
// the Go version: this only catches the exact seeded example strings
// docs/goals/0061 names, not a general "did someone hardcode a
// concept" analyzer, and a match inside an unrelated string (a comment
// that happens to say "the document says...") would be a false
// positive worth reading before assuming a real violation.
const SEEDED_CONCEPT_NAMES = ['Topic', 'Contact', 'Document', 'relates to', 'The engagement']

const ATLAS_DIR = join(__dirname)

function nonTestSourceFiles(): string[] {
  return readdirSync(ATLAS_DIR)
    .filter((name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'))
    .map((name) => join(ATLAS_DIR, name))
}

describe('Atlas frontend source carries no hardcoded seeded concept', () => {
  it('never contains a seeded Kind/LinkKind name outside a seed/test file', () => {
    for (const path of nonTestSourceFiles()) {
      const content = readFileSync(path, 'utf-8')
      for (const name of SEEDED_CONCEPT_NAMES) {
        expect(content.includes(name), `${path} contains seeded concept name "${name}" -- ADR-0038 Decision 2 requires every card-kind/link-kind name to live only in a seed file`).toBe(false)
      }
    }
  })
})
