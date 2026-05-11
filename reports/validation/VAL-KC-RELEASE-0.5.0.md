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

- `npm.cmd view @sawadari/kc version`: passed, latest is `0.5.0`.
- `v0.5.0` tag: passed, points to release commit `840ba77`.
- `v0` tag: passed, moved to release commit `840ba77`.
- GitHub Release `v0.5.0`: published.
- Sample repository PR: `sawadari/KC@v0` passed in https://github.com/sawadari/kc-validation-sample/actions/runs/25703317728/job/75468016983.
- Sample repository comparison run: `sawadari/KC@main` passed in https://github.com/sawadari/kc-validation-sample/actions/runs/25703214371.
- Residual finding: invoking KC twice in the same workflow run can conflict on the evidence artifact name. Tracked as https://github.com/sawadari/KC/issues/42.

## Judgment

KC v0.5.0 is valid for the normal single-action GitHub Action path and npm CLI distribution. The v0.4 GitHub Action runtime failure is fixed by the v0.5.0 `v0` tag movement. Multiple KC invocations in one workflow run remain a follow-up issue because artifact names are not yet unique per invocation.
