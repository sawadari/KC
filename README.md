# KC

KC is a distributable Knowledge Convergence guard for Codex + GitHub development workflows.

It turns Issue intent, Codex plans, human approval, verification evidence, validation evidence, and PR diffs into a deterministic merge-readiness signal.

KC does not treat AI output as approval. AI assist can draft questions, plans, evidence bundles, and PR explanations, but the gate result is always produced by deterministic rules.

Japanese documentation: [README.ja.md](README.ja.md)

## Install

```bash
npx @sawadari/kc init --workspace .
npx @sawadari/kc check --workspace .
```

Use in GitHub Actions:

```yaml
name: KC Guard

on:
  pull_request:

jobs:
  kc:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
      actions: read
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: sawadari/KC@v0
        env:
          GITHUB_TOKEN: ${{ github.token }}
        with:
          ai-assist: false
          comment-on-pr: true
```

## CLI

```bash
kc init --workspace .
kc check --workspace .
kc bundle --workspace .
kc assist --kind issue-questions --input issue.md
```

`kc check` exits with code `1` for `HOLD` and `FAIL`. `kc bundle` writes the generated Evidence Bundle but does not fail the process.

AI assist uses `OPENAI_API_KEY` or `--openai-api-key`. It is optional; deterministic checks do not require credentials.

## Artifacts

KC reads these files from the target repository:

- `.kc/issue.yaml`
- `.kc/plan.yaml`
- `.kc/approval.yaml`
- `.kc/agent_envelope.yaml`
- `.kc/evidence_bundle.yaml`
- `.kc/ruleset.yaml`

`kc init` installs examples and GitHub templates. Existing files are not overwritten unless `--force` is passed.

## Decisions

- `PASS`: merge-ready.
- `WARN`: merge may proceed with notes.
- `HOLD`: merge should be blocked until the finding is resolved or explicitly handled.
- `FAIL`: invalid or policy-violating state.

## Rules

The first release implements KC-AE-001 through KC-AE-012:

- required Issue fields
- validation scenario requirements by risk tier
- Plan existence and approval
- approved scope and prohibited path checks
- verification evidence requirements
- verification/validation separation
- approval condition evidence
- agent audit references
- high-risk rollback path
- merge readiness

`.kc/ruleset.yaml` is executable policy. `ruleset.rules` limits which KC-AE rules run, and `ruleset.severity_overrides` can override a finding severity by rule ID:

```yaml
ruleset:
  rules:
    - KC-AE-001
    - KC-AE-007
  severity_overrides:
    KC-AE-007: warning
```

## Release

The GitHub Action is intended to be consumed as:

```yaml
- uses: sawadari/KC@v0
```

The CLI is intended to be consumed as:

```bash
npx @sawadari/kc check --workspace .
```

## License

Apache-2.0.
