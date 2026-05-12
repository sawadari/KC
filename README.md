# KC

KC is a merge-readiness guard for AI-assisted GitHub pull requests.

When an agent can change code quickly, the hard part is no longer "can we produce a diff?" It is "can a reviewer see the original intent, approved scope, evidence, and validation story before merging?" KC turns that trail into a deterministic `PASS`, `WARN`, `HOLD`, or `FAIL`.

KC is designed for teams using Codex or other coding agents who want a lightweight way to keep AI-assisted work reviewable, auditable, and scoped.

[Japanese README](README.ja.md)

## Why KC

Use KC when you want every PR to answer these questions:

- What issue or user problem is this PR solving?
- What plan was approved before implementation started?
- Are the changed files inside the approved scope?
- What verification and validation evidence exists?
- Is the merge decision based on deterministic rules instead of AI opinion?

KC does not approve work for you. It makes missing context visible before merge.

## Where Humans Decide

KC separates human judgment from deterministic checking:

- Humans decide whether the Issue is worth doing and whether the acceptance criteria are sufficient.
- Humans approve, conditionally approve, request changes, or reject the Plan before implementation.
- Humans judge whether validation evidence is convincing for the real product or operational risk.
- KC checks that those decisions were recorded, that the diff stayed in scope, and that required evidence exists.

KC cannot cryptographically prove who typed an approval. It requires durable human approval evidence, such as a GitHub Issue comment URL, so reviewers can inspect the decision trail.

## Try It Now

Check the published CLI:

```bash
npx -y @sawadari/kc --help
```

Add KC templates to an existing repository:

```bash
npx -y @sawadari/kc init --workspace .
```

That installs `.kc` examples, GitHub templates, an `AGENTS.md` starter, and optional Codex hook templates. Existing files are not overwritten unless you pass `--force`.

For a real PR, copy the examples into active KC artifacts and fill in the details:

```bash
cp .kc/issue.example.yaml .kc/issue.yaml
cp .kc/plan.example.yaml .kc/plan.yaml
cp .kc/approval.example.yaml .kc/approval.yaml
cp .kc/agent_envelope.example.yaml .kc/agent_envelope.yaml
cp .kc/evidence_bundle.example.yaml .kc/evidence_bundle.yaml
```

The examples are intentionally not merge-ready. Replace placeholder values, record real human approval evidence, and attach verification/validation evidence before expecting `PASS`.

Then run the deterministic check:

```bash
npx -y @sawadari/kc check --workspace .
```

`kc check` exits non-zero for `HOLD` and `FAIL`, which makes it suitable for CI gates.

## Numbered Approval Flow

For Codex-driven work, KC can print a brief that the human can answer with a number:

```bash
npx -y @sawadari/kc approval-brief --workspace .
```

The brief asks for one of these choices:

1. Approve
2. Approve with conditions
3. Request changes
4. Reject

After the human replies, mirror that decision to a durable source, usually a GitHub Issue comment. Then record the comment URL:

```bash
npx -y @sawadari/kc approval-record \
  --workspace . \
  --choice 1 \
  --actor sawadari \
  --source github_issue_comment \
  --ref https://github.com/OWNER/REPO/issues/123#issuecomment-123456 \
  --summary "Approved the plan after reviewing scope and risks."
```

`kc check` treats `approved` or `approved_with_conditions` without `human_approval.actor`, `human_approval.source`, and `human_approval.ref` as non-merge-ready.

## Add The GitHub Action

Create `.github/workflows/kc-guard.yml`:

```yaml
name: KC Guard

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  kc:
    if: github.event_name == 'pull_request'
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
          comment-on-linked-issue: false

  kc-current:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: sawadari/KC@v0
        env:
          GITHUB_TOKEN: ${{ github.token }}
        with:
          mode: current
          ai-assist: false
          comment-on-pr: false
```

On pull requests, the Action reads the KC artifacts, compares the PR changed files with the approved scope and prohibited paths, writes an Evidence Bundle, and posts a summary when configured. On `main` pushes, current mode checks that the repository ledger is not stale after merge or release completion.

Useful Action inputs:

- `mode`: `pr` for merge readiness, or `current` for main-branch ledger checks.
- `artifact-name`: optional evidence artifact name. By default KC generates a unique per-run name to avoid collisions in matrix or multi-job workflows.
- `evidence-output`: optional path for the generated Evidence Bundle. In GitHub Actions the default is under runner temp.

Action outputs:

- `decision`: `PASS`, `WARN`, `HOLD`, or `FAIL`
- `merge_ready`: `true` for `PASS` and `WARN`
- `primary_reason`: the main reason code behind the result
- `findings_json`: machine-readable findings
- `evidence_bundle_path`: generated Evidence Bundle path

## What The Decisions Mean

| Decision | Meaning | CI behavior |
|---|---|---|
| `PASS` | The PR has the required KC context and no blocking findings. | Succeeds |
| `WARN` | Merge can proceed, but KC found something reviewers should notice. | Succeeds with annotations |
| `HOLD` | Something important is missing or outside approved scope. | Fails |
| `FAIL` | The artifacts or policy state are invalid. | Fails |

## Daily Workflow

1. Open an issue with the problem, expected outcome, acceptance criteria, and non-goals.
2. Ask the agent to produce a plan and write it into `.kc/plan.yaml`.
3. Record human approval in `.kc/approval.yaml`.
4. Let the agent implement within the approved scope.
5. Add verification and validation evidence to `.kc/evidence_bundle.yaml`.
6. Run `kc check` locally or let the GitHub Action gate the PR.
7. After merge or release, run `kc finalize` to close the evidence and mark `.kc/current.yaml` as no longer active.

This keeps "what we asked for", "what was approved", "what changed", and "what proved it works" in the repository instead of scattered across chat history.

## CLI Commands

```bash
kc init --workspace .
kc check --workspace . --output .kc/evidence_bundle.generated.yaml
kc bundle --workspace . --output .kc/evidence_bundle.generated.yaml
kc assist --kind issue-packet --input issue.md --offline-template
kc issue-brief --input issue.md
kc issue-record --issue-ref URL --problem text --expected-outcome text --acceptance-criterion text --non-goal text
kc issue-sync --issue-ref URL --workspace .
kc issue-check --workspace .
kc approval-brief --workspace .
kc approval-record --choice 1 --actor sawadari --source github_issue_comment --ref URL
kc finalize --workspace . --issue-ref URL --pr-ref URL --release-ref URL --npm-ref @scope/name@version --verify-external=public
kc close-work --workspace . --archive
kc check --workspace . --mode current
kc promote --workspace . --output-dir reports/promotion
```

Command summary:

- `kc init`: install templates without overwriting existing files.
- `kc check`: run deterministic rules and fail on `HOLD` or `FAIL`. Use `--output` to choose where the generated Evidence Bundle is written.
- `kc bundle`: generate the Evidence Bundle without failing the process. Use `--output` to choose the generated bundle path.
- `kc assist`: draft candidate artifacts; AI output never changes the deterministic decision.
- `kc issue-brief`: turn an intake note into a human-fillable issue brief.
- `kc issue-record`: write `.kc/issue.yaml` from explicit issue fields.
- `kc issue-sync`: draft `.kc/issue.yaml` from a GitHub Issue body using deterministic heading parsing.
- `kc issue-check`: validate the issue artifact before planning.
- `kc approval-brief`: print the Issue, Plan, scope, risk, and numbered human decision choices.
- `kc approval-record`: record a numbered human decision into `.kc/approval.yaml`.
- `kc finalize`: turn PR-time evidence into finalized evidence after merge or release. Use `--verify-external=public` for unauthenticated public checks, or `--verify-external=authenticated` when an authenticated `gh` session is intentionally available.
- `kc close-work`: archive active `.kc` artifacts and mark current work inactive.
- `kc check --mode current`: detect stale main-branch lifecycle state.
- `kc promote`: generate candidate DecisionLedger and related promotion files for human review.

AI assist is optional. It uses `OPENAI_API_KEY` or `--openai-api-key` only when requested. Deterministic checks work without API credentials.

## KC Artifacts

KC reads these files from the target repository:

- `.kc/issue.yaml`: problem, expected outcome, acceptance criteria, risk tier, non-goals
- `.kc/plan.yaml`: interpreted requirement, implementation plan, allowed files, prohibited files
- `.kc/approval.yaml`: human approval evidence and approval conditions
- `.kc/agent_envelope.yaml`: agent identity and execution boundaries
- `.kc/evidence_bundle.yaml`: verification, validation, PR, and audit evidence
- `.kc/current.yaml`: active/finalized lifecycle state for the current work item
- `.kc/ruleset.yaml`: enabled rules and severity overrides
- `.kc/config.yaml`: optional GitHub Action enforcement scope

The examples created by `kc init` are intentionally explicit and pending. Active artifacts containing common example placeholders are blocked by KC.

`kc check` writes generated evidence separately from the canonical `.kc/evidence_bundle.yaml`. The default local path is `.kc/evidence_bundle.generated.yaml`, which is ignored by the KC template. Use `--output` when you want a different path. The GitHub Action writes generated evidence under runner temp unless `evidence-output` is set.

## Artifact Lifecycle

KC treats active PR artifacts and finalized evidence differently:

- Active artifacts tell Codex and reviewers what work is currently approved.
- Finalized artifacts explain what already happened after a PR or release is completed.

Use `kc finalize` after merge or release completion:

```bash
kc finalize --workspace . \
  --issue-ref https://github.com/OWNER/REPO/issues/123 \
  --pr-ref https://github.com/OWNER/REPO/pull/456 \
  --release-ref https://github.com/OWNER/REPO/releases/tag/v1.2.3 \
  --npm-ref @scope/package@1.2.3
```

This updates `.kc/evidence_bundle.yaml`, writes `.kc/current.yaml`, and archives the final bundle under `.kc/archive/`.

Post-merge evidence status values distinguish captured references from verified facts:

- `recorded`: KC captured the reference but did not independently verify it.
- `passed`: KC or the release process verified the expected external state.
- `unverified`: verification was attempted but could not confirm the expected state.
- `failed`: verification contradicted the expected state.

Use current-mode checks on `main` or release branches when you want to catch stale lifecycle state:

```bash
kc check --workspace . --mode current
```

In PR mode, KC also protects against reusing a previous finalized work item. If `.kc/current.yaml` says `active_work: false` or `lifecycle_state: finalized`, a new PR that changes non-`.kc` files must establish fresh `.kc/issue.yaml`, `.kc/plan.yaml`, and `.kc/approval.yaml` artifacts.

Use `kc close-work --archive` when active artifacts should be copied into `.kc/archive/<work-id>/` and `.kc/current.yaml` should show `active_work: false`.

## Enforcement Scope

By default, the GitHub Action expects KC PR sections on every PR. To adopt KC gradually, add `.kc/config.yaml`:

```yaml
kc:
  enforcement:
    mode: opt_in
    require_when:
      labels:
        - codex
      changed_paths:
        - src/**
      pr_body_marker: "KC: required"
```

Supported modes are `strict`, `opt_in`, and `disabled`.

## Ruleset Control

`.kc/ruleset.yaml` is executable policy. Use `ruleset.rules` to limit which KC-AE rules run, and `ruleset.severity_overrides` to adjust severity by rule ID:

```yaml
ruleset:
  rules:
    - KC-AE-001
    - KC-AE-007
  severity_overrides:
    KC-AE-007: warning
```

The current rules cover required issue fields, validation scenarios, plan approval, approved scope, prohibited files, verification evidence, verification/validation separation, approval-condition evidence, agent audit references, high-risk rollback paths, merge readiness, explicit human approval evidence, placeholder detection, risk-aware validation pending, plan-item trace checks, current-mode lifecycle stale-state checks, and stale finalized artifact reuse in PR mode.

## Optional Codex Hooks

KC ships optional hook templates under `templates/hooks/` for `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, and `Stop`.

These hooks are local enforcement aids. They are not active unless you wire them into your Codex hook configuration, and they do not replace the GitHub Action gate.

## License

Apache-2.0.
