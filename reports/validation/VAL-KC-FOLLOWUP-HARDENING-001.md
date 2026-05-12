# KC Follow-up Hardening Validation

Date: 2026-05-12 JST

## Scope

Validate the follow-up hardening batch for Issues #42, #44, #45, #46, #47, #48, and #50.

## Implemented

- `KC-AE-021` blocks PR-mode reuse of finalized inactive artifacts when new non-`.kc` changes do not establish fresh issue, plan, and approval artifacts.
- GitHub Action inputs now include `mode`, `artifact-name`, and `evidence-output`.
- Action artifact names default to unique per-run names to avoid evidence upload conflicts.
- `kc check` and `kc bundle` support `--output` for generated evidence bundle paths.
- GitHub Action generated evidence defaults to runner temp.
- CI and templates include current-mode validation on `main` pushes.
- `kc finalize --verify-external` supports explicit `public` and `authenticated` modes.
- External verification evidence now uses `passed` / `unverified` and records verification mode.
- `kc issue-sync` deterministically drafts `.kc/issue.yaml` from GitHub Issue markdown headings.

## Verification

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 37 tests.
- `npm.cmd run pack:dry`: passed.
- `npm.cmd run build`: passed and updated `dist/action/index.js` for the Action distribution.
- `git diff --check`: passed.
- `node lib/cli/index.js check --workspace . --changed-file ... --json`: passed, decision `PASS`, findings `[]`.
- PR #51 CI: passed.
- Main push CI after merge: passed, including `kc-current`.

## Residual Scope

- Issue #49, Plan Change Request artifact and approval flow, remains open for a separate larger implementation.
- The current PR does not publish a new npm release.

## Judgment

The hardening batch is valid for PR review. The highest-risk gap, stale finalized artifact reuse in PR mode, is covered by a deterministic rule and regression tests.
