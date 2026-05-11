# KC Human Approval Evidence Validation Report

Date: 2026-05-11
Issue: `#13`
Plan: `PLAN-KC-HUMAN-APPROVAL-001`

## Scenario

Codex presents a numbered approval brief, the human replies with a simple number, the decision is mirrored to a durable GitHub Issue comment, and KC records that comment URL as human approval evidence. `kc check` must also hold approved plans that lack that evidence.

## Evidence

| Check | Expected | Observed |
|---|---:|---:|
| Primary numbered approval | GitHub Issue comment URL recorded | https://github.com/sawadari/KC/issues/13#issuecomment-4421612950 |
| Scope amendment approval | GitHub Issue comment URL recorded | https://github.com/sawadari/KC/issues/13#issuecomment-4421669229 |
| Default ruleset scope amendment | GitHub Issue comment URL recorded | https://github.com/sawadari/KC/issues/13#issuecomment-4421704563 |
| Missing `human_approval` on an approved plan | `HOLD` with `missing_human_approval_evidence` | covered by unit test |
| `kc approval-brief --workspace .` | prints numbered choices 1-4 | passed |
| `kc approval-record` | writes `human_approval.actor/source/ref` | covered by unit test |
| Repository typecheck | `npm.cmd run check` passes | passed |
| Repository test suite | `npm.cmd test` passes | passed, 22 tests |
| Package dry run | `npm.cmd run pack:dry` passes | passed |
| KC self-check | `node lib/cli/index.js check --workspace . --changed-files <tmp>` passes | passed |

## Result

Status: passed. The implementation adds explicit human approval evidence as a deterministic merge-readiness requirement while keeping the human decision lightweight enough for Codex conversations.
