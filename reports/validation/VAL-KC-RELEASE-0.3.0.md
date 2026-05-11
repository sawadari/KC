# VAL-KC-RELEASE-0.3.0

## Scope

Release KC v0.3.0 so the already merged human approval flow is available from npm and the GitHub Action v0 tag.

## Human Approval Evidence

- Issue: https://github.com/sawadari/KC/issues/15
- Approval comment: https://github.com/sawadari/KC/issues/15#issuecomment-4421796779
- Decision: approved

## Release Candidate Checks

- `npm.cmd run check`: passed
- `npm.cmd test`: passed
- `npm.cmd run pack:dry`: passed
- `dist/action/index.js`: rebuilt by `npm.cmd test` and `npm.cmd run pack:dry`; no content diff from main after rebuild
- `node lib/cli/index.js check --workspace . --changed-files <tmp>`: passed

## Publication Checks

- npm package `@sawadari/kc@0.3.0`: pending
- GitHub release `v0.3.0`: pending
- GitHub Action major tag `v0`: pending
