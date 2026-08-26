// looksLikeCode is ClipboardHistoryDialog.tsx's own heuristic for goal
// 0234's design contract ("multi-line preserved, monospace for
// code-looking content"): multi-line preservation applies to every
// entry, monospace is reserved for content that actually reads as
// code. A single consumer -- stays co-located here rather than in
// shared/ (.claude/rules/frontend.md's "used by exactly one caller"
// rule).
const CODE_TOKEN_PATTERN = /[{};]|=>|^\s*(function|const|let|var|def|class|import|#include|package|func)\b/m

export function looksLikeCode(text: string): boolean {
  const lines = text.split('\n')
  if (lines.length > 1 && lines.some((line) => /^[ \t]+\S/.test(line))) {
    return true
  }
  return CODE_TOKEN_PATTERN.test(text)
}
