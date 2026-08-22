---
id: "0036"
status: shipped
date: "2026-08-15"
prs: []
proof: []
spec_refs: []
---

---
# 0036 -- A goal file whose body opens with its own horizontal rule

This reproduces the real archive hazard: a standalone "---" markdown
horizontal rule sits between the frontmatter's closing delimiter and
the "# Title" heading (docs/goals/archive/0036 and /0037 both carry
this shape). A parser bounded only by "does this line equal ---"
without also tracking WHICH occurrence is the real close would treat
this rule as a second frontmatter block's opener, or worse consume the
heading text as YAML.
