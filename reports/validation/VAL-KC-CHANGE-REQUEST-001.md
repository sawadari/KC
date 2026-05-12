# VAL-KC-CHANGE-REQUEST-001

## Scope

Validation for Issue #49: first-class Plan Change Request support.

The change adds:

- `.kc/change_request.yaml` loading and template support.
- `kc change-request` CLI helper.
- Deterministic `KC-AE-022` behavior for pending and approved scope additions.
- Documentation for the scope expansion flow.

## Verification

Local verification on 2026-05-12:

| Check | Result |
|---|---|
| `npm.cmd run check` | passed |
| `npm.cmd test` | passed, 41 tests |
| `npm.cmd run pack:dry` | passed |
| `npm.cmd run build` | passed |
| `git diff --check` | passed |
| `node lib/cli/index.js check ...` | passed, KC PR Check `PASS` |
| GitHub Actions on PR #53 | passed |
| GitHub Actions on main commit `e95ef8ea2eec130fc90c9086f57a4e6d1135c9c4` | passed, run https://github.com/sawadari/KC/actions/runs/25705093790 |
| `node lib/cli/index.js check --mode current` after finalize | passed |

`npm.cmd run pack:dry` confirmed the npm package includes `lib/core/change-request.*` and `templates/.kc/change_request.example.yaml`.

## Behavioral Validation

Focused tests cover:

- A pending Plan Change Request returns `HOLD` when changed files rely on the requested scope.
- An approved Plan Change Request with durable `human_approval` evidence extends approved scope and returns `PASS`.
- An approved Plan Change Request without `human_approval.actor`, `human_approval.source`, and `human_approval.ref` returns `HOLD`.
- `kc change-request` creates `.kc/change_request.yaml`.

## Remaining Limits

- The helper creates the request artifact, but human approval must still be mirrored manually into the artifact.
- KC does not edit the original approved plan when a change request is approved; it treats the approved request as an auditable scope extension during rule evaluation.
- GitHub Actions validation passed on PR #53 and on the merged main commit.

## Validation Status

passed
