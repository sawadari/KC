# KC v0.5.0 Release Validation

Date: 2026-05-12 JST

## Scope

Validate KC v0.5.0 release preparation after the GitHub Action runtime fix.

## Pre-Release Checks

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 32 tests.
- `npm.cmd run pack:dry`: passed.
- `npm.cmd run build; git diff --exit-code -- dist/action/index.js dist/action/package.json`: passed.
- `node lib/cli/index.js check --workspace . --changed-file ... --json`: passed, decision `PASS`, merge ready `true`, findings `[]`.

## Post-Release Checks

- Pending: npm latest should be `0.5.0`
- Pending: `v0.5.0` and `v0` should point to the release commit
- Pending: sample PR should pass both `sawadari/KC@v0` and `sawadari/KC@main`

## Judgment

Local release checks passed. Publishing, tag movement, and sample repository validation remain post-merge tasks.
