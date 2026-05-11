# KC Bootstrap Validation Report

Date: 2026-05-11
Repository: `sawadari/KC`
Scope: KC v0.1.0 initial release and self-governance artifacts.

## Validation Scenario

The KC repository can run its own guard against the approved initial release scope and produce `PASS` while keeping verification and validation evidence separate.

## Evidence Summary

The fixture suite was executed to confirm the four intended decision branches:

| Scenario | Expected | Observed |
|---|---:|---:|
| Complete approved change with verification and validation evidence | PASS | PASS |
| Medium-risk issue with validation explicitly pending | WARN | WARN |
| Change outside approved scope and prohibited path | HOLD | HOLD |
| Validation marked passed without validation evidence | FAIL | FAIL |

Repository-level verification was also executed:

| Command or Check | Result |
|---|---:|
| `npm test` | passed |
| `npm audit --audit-level=moderate` | passed |
| GitHub Actions run `25670022466` | passed |
| `node lib/cli/index.js check --workspace . --changed-files <initial-release-list>` | PASS |

## Validation Result

Status: passed

KC correctly distinguishes deterministic merge-readiness from AI assistance and keeps verification evidence separate from validation evidence. The bootstrap repository self-check passed when run with the approved initial release changed-file set.
