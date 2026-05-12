# VAL-KC-INIT-NRVV-CANDIDATES-001

## Scope

Validation for Issues #73 and #74:

- preserve existing `AGENTS.md` by default during `kc init`;
- provide a safe KC agent guidance merge snippet;
- make `required` NRVV the recommended template profile;
- provide draft-only NRVV candidates for incomplete Issues.

## Verification

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed with 58 tests.
- Unit and CLI tests verify default `AGENTS.md` preservation, explicit `--force` overwrite, and `skipped AGENTS.md` output.
- Tests verify `nrvv_profile: required` is accepted as a blocking profile.
- Tests verify `kc nrvv-candidate` emits deterministic draft output without `OPENAI_API_KEY`.
- Tests verify NRVV candidate validation rejects authority claims such as `validation_status: passed`.

## User-Oriented Sample Validation

A temporary sample workspace was used to model an existing repository with its own `AGENTS.md`.

Scenario:

1. Create a sample repository with `AGENTS.md` containing existing local guidance.
2. Run `node lib/cli/index.js init --workspace <sample>`.
3. Confirm `AGENTS.md` remains unchanged.
4. Confirm CLI output includes `skipped AGENTS.md`.
5. Confirm `docs/KC_AGENTS_GUIDANCE.md` exists as a safe merge reference.
6. Create an incomplete Issue Markdown file.
7. Run `node lib/cli/index.js nrvv-candidate --workspace <sample> --input issue.md` without `OPENAI_API_KEY`.

Expected behavior:

- Init does not overwrite the existing `AGENTS.md`.
- The user can inspect KC-specific guidance separately.
- NRVV candidate output is marked `candidate_status: draft`.
- NRVV candidate output keeps `validation_status: pending`.
- Candidate generation does not modify `.kc/issue.yaml` and does not change deterministic check decisions.

## Behavioral Validation

The feature supports the intended user outcome:

- KC adoption is non-destructive by default for existing agent instructions.
- NRVV is presented as the expected default for new KC-managed work.
- Missing NRVV fields lead to reviewable draft candidates instead of silent guessing.
- AI assistance remains candidate-only and does not become approval or validation evidence.

## Remaining Limits

- KC does not automatically merge arbitrary `AGENTS.md` content because that would risk damaging project-specific policy.
- `kc nrvv-candidate` provides a draft, not a complete requirements-management workflow.
- Future user feedback should determine whether `required` should become the implicit engine default for repositories without a ruleset.
