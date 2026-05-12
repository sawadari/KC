# VAL-KC-NRVV-ISSUE-001

## Scope

Validation for Issue #56: optional NRVV structure in KC Issues.

The change adds:

- NRVV blocks to the GitHub Issue template and `.kc/issue.example.yaml`.
- NRVV Issue Discipline guidance in `AGENTS.md`.
- README / README.ja explanation of Need, Requirement, Verification, and Validation.
- Deterministic `issue-sync` parsing for NRVV headings.
- Warning-level `KC-NRVV-001` through `KC-NRVV-008` checks.
- Generated Evidence Bundle `nrvv_trace` entries.

## Verification

Local verification on 2026-05-12:

| Check | Result |
|---|---|
| `npm.cmd run check` | passed |
| `npm.cmd test` | passed, 44 tests |
| `npm.cmd run pack:dry` | passed |
| `npm.cmd run build` | passed |
| `git diff --check` | passed |
| KC self-check with explicit changed files | passed, `PASS` |
| GitHub Actions on PR #57 | passed |
| GitHub Actions on main commit `7f7ddea432f00c3d2bf6f9e619b0a0de23b8373c` | passed, run https://github.com/sawadari/KC/actions/runs/25707322854 |
| `node lib/cli/index.js check --workspace . --mode current` after finalize | passed |

`npm.cmd run pack:dry` confirmed the npm package includes the updated README files, Issue template, `.kc/issue.example.yaml`, ruleset template, AGENTS template, and rebuilt Action bundle.

## Behavioral Validation

Focused tests cover:

- Existing fully evidenced legacy Issue fixtures still return `PASS`.
- Incomplete NRVV Issue structure emits warning-level `KC-NRVV-*` findings instead of blocking merge by default.
- Complete NRVV Issue structure generates `nrvv_trace` with Need, Requirement, Verification, Validation, and unresolved gap entries.
- `issueFromMarkdown` parses NRVV headings into optional `.kc/issue.yaml` fields.

## Remaining Limits

- NRVV remains optional by default to avoid breaking existing KC users.
- The first rules are warning-level guardrails, not a complete requirements-management system.
- `nrvv_trace` is generated from repository-local artifacts and does not independently validate domain truth.
- Workflow validation should continue through dogfooding on future KC Issues.
- GitHub Actions validation passed on PR #57 and on the merged main commit.

## Validation Status

passed
