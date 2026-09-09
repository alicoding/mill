# Engineering health

Generated 2026-09-09T07:00:00Z UTC. Trailing 7 and 28 days.

## Delivery

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| PR lead time p50 | 13.5h | 24.0h | 24.0h | ↓ | ✅ |
| PR lead time p90 | 21.9h | 100.8h | — | ↓ | — |
| Merges/week | 2 | 1 | — | ↑ | — |
| Merge-group failure rate | 50.0% | 33.3% | 10.0% | ↑ | ⚠️ |
| Time-to-green on main p50 | 10.0min | 12.5min | — | ↓ | — |

## CI

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| Merge-group wall time p50 | 45.0min | 30.0min | 45.0min | ↑ | ✅ |
| Merge-group wall time p90 | 57.0min | 54.0min | — | ↑ | — |
| Runner queue wait p50 | 3.0min | 4.0min | 10.0min | ↓ | ✅ |
| Jobs per run | 2 | 1 | — | ↑ | — |
| macOS-job share | 33.3% | 50.0% | — | ↓ | — |

## Test

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| Retry-passed test count | 1 | 2 | — | ↓ | — |
| Retry-passed rate | 33.3% | 16.7% | 1.0% | ↑ | ⚠️ |
| QUARANTINE active rows | 2 | 3 | — | ↓ | — |

## Code

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| Files near LOC cap | 1 | 1 | 10 | → | ✅ |
| gocognit offenders | 2 | 2 | — | → | — |
| sonarjs offenders | 2 | 2 | — | → | — |
| Go coverage | 40.0% | 40.0% | 75.0% | → | ⚠️ |
| Vitest coverage (lines) | 14.2% | 14.2% | 12.0% | → | ✅ |
| check-*.sh gate count | 2 | 2 | — | → | — |

## Platform

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| Maturity ledger stable/total | 2/4 | 2/4 | — | → | — |

## Dependencies

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| Open Dependabot PRs | 2 | 2 | — | → | — |
| Max Dependabot PR age | 12.0d | 12.0d | 7.0d | → | ⚠️ |

## Machinery

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| Open goal PRs | 3 | 3 | 6 | → | ✅ |
| Shepherd re-merge rounds | 1 | 4 | — | ↓ | — |

## Currency

| Metric | 7d | 28d | Budget | Trend | Status |
|---|---|---|---|---|---|
| Go toolchain | 1 minors behind | 1 minors behind | 1 minors behind | → | ✅ |
| Node | 1 minors behind | 1 minors behind | 1 minors behind | → | ✅ |
| Wails | 0 betas behind | 0 betas behind | 1 betas behind | → | ✅ |
| Playwright | 2 minors behind | 2 minors behind | 1 minors behind | → | ⚠️ |

