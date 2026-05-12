# VAL-KC-ARTIFACT-RESPONSIBILITY-001

## Scope

Validation for Issue #71: clarify the relationship between GitHub records and `.kc` artifacts, add Issue source snapshot metadata, add drift checking, and include Issue snapshot metadata in generated Evidence Bundles.

## Verification

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed with 54 tests.
- Unit coverage verifies source metadata preservation.
- Unit coverage verifies generated Evidence Bundle `source_snapshots.issue`.
- CLI coverage verifies `kc issue-sync --check --issue-file` reports drift with user-facing resolution options.

## User-Oriented Sample Validation

A temporary sample workspace was used to model a user who has an existing `.kc/issue.yaml` snapshot and a newer Issue Markdown body.

Scenario:

1. Record a current `.kc/issue.yaml` snapshot.
2. Create an `issue.md` source candidate with a changed Problem or Acceptance Criteria.
3. Run:

```bash
node lib/cli/index.js issue-sync --workspace <sample> --issue-ref https://github.com/sawadari/KC/issues/71 --check --issue-file issue.md
```

Expected behavior:

- CLI exits non-zero because drift was detected.
- Output starts with `KC issue-sync check: WARN`.
- Output lists the changed fields.
- Output includes resolution options: re-sync, keep the current snapshot with documented rationale, or update the GitHub Issue and check again.

## Behavioral Validation

The feature supports the intended user distinction:

- GitHub Issue is the human collaboration record.
- `.kc/issue.yaml` is the normalized snapshot used for KC gating.
- Drift is not silently ignored.
- Normal `kc check` remains deterministic and does not require GitHub API access.

## Remaining Limits

- The first drift implementation compares parsed Issue packet fields rather than a full semantic diff.
- `--issue-file` is intended for samples and offline validation; live GitHub drift checks still depend on `gh issue view`.
- Future work may add explicit drift acceptance metadata or a separate artifact.
