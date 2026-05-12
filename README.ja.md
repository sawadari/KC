# KC

KC は、AI エージェントが作った GitHub Pull Request を「merge してよい状態か」判定するためのガードです。

Codex のようなエージェントはすばやく差分を作れます。そこで問題になるのは「コードを書けるか」ではなく、「何を頼んだのか、どこまで承認したのか、何で確認したのかを、merge 前にレビューできるか」です。KC はその流れを `PASS` / `WARN` / `HOLD` / `FAIL` に変換します。

AI に実装を任せても、最終判断を AI の雰囲気に任せたくないチーム向けの、軽量な merge gate です。

[English README](README.md)

## KC が解く問題

KC は PR ごとに、次の問いを見える化します。

- この PR はどの Issue / ユーザー課題を解いているのか
- 実装前にどの Plan が承認されたのか
- 変更ファイルは承認済み scope の中に収まっているか
- verification / validation evidence はあるか
- merge 判定は AI の文章ではなく、決定的なルールで出ているか

KC は人間の代わりに承認しません。承認前に足りない文脈を見つけます。

## Knowledge Convergence との関係

KC は、[Knowledge Convergence / 知識収束学](https://github.com/sawadari/knowledge-convergence) の考え方を、AI支援開発と GitHub Pull Request の文脈に絞って実装した実験的なツールです。

Knowledge Convergence は、AI出力、人間の主張、根拠、判断、運用フィードバックを、組織が判断可能な知識状態へ変換するための、より広い理論・仕様・語彙・適合検査の枠組みです。KC はその全体を実装するものではなく、AIコーディングエージェントが作る GitHub PR に対して、選択された一部の考え方を実用上の gate として適用します。

このリポジトリでは、次のように対応づけています。

- GitHub Issue は、元の問題、意図、受け入れ条件、妥当性確認文脈を表す
- `.kc/plan.yaml` は、実装計画と承認済み scope を表す
- `.kc/approval.yaml` は、人間の承認証跡を表す
- `.kc/evidence_bundle.yaml` は、Issue、Plan、承認、PR差分、verification evidence、validation evidence、ライフサイクル状態を接続する
- `kc check` は、文脈・承認・証跡の不足を、決定的な `PASS` / `WARN` / `HOLD` / `FAIL` に変換する

KC は、知識収束学全体の標準的・完全な実装ではありません。また、要求管理ツール、PLM、ALM、システムズエンジニアリング基盤を置き換えるものでもありません。KC は、Codex などのAIコーディングエージェントが GitHub Pull Request を作る具体的な開発フローに対する、軽量なガードレイヤーです。

## GitHub 記録と `.kc` snapshot

KCでは、人間向けのGitHub上の記録と、機械判定向けの `.kc` artifact を意図的に分けています。これらは関係していますが、完全に同じ正本ではありません。

- GitHub Issue は、人間の協働記録です。問題提起、背景、議論、承認コメント、例外判断、Issue closeを扱います。
- GitHub Pull Request は、変更差分とreviewの記録です。commit、diff、review comment、CI、mergeを扱います。
- `.kc/*.yaml` は、repo内のKnowledge Convergence artifactです。KCとAI coding agentが決定的に読めるように正規化したsnapshotです。
- `reports/validation/` は、詳細なVerification / Validation記録を置く場所です。
- `.kc/archive/` は、merge後またはrelease後にfinalizeされたEvidence Bundleを保管する場所です。

想定する流れは次です。

```text
GitHub Issue
  -> kc issue-sync / 人間確認
  -> .kc/issue.yaml
  -> .kc/plan.yaml
  -> .kc/approval.yaml
  -> Pull Request
  -> .kc/evidence_bundle.yaml
  -> kc finalize
  -> .kc/archive/
```

このモデルでは、`GitHub Issue` は人間の協働記録であり、`.kc/issue.yaml` はKC gateで使う正規化snapshotです。snapshotには `artifact_role: normalized_snapshot` と `source` metadata を残し、reviewerが出所を確認できるようにします。

GitHub Issue本文と `.kc/issue.yaml` がズレた場合、`.kc/issue.yaml` は人間が再同期またはdriftの受け入れを明示するまで、PR gateで使うsnapshotとして扱います。planning前やreview前にdriftを確認できます。

```bash
kc issue-sync --issue-ref https://github.com/OWNER/REPO/issues/123 --check --workspace .
```

サンプルやoffline reviewでは、Markdownファイルと比較できます。

```bash
kc issue-sync --issue-ref https://github.com/OWNER/REPO/issues/123 --check --issue-file issue.md --workspace .
```

## 人間が判断する場所

KC は、人間の判断と機械的な検査を分けます。

- 人間は、その Issue をやるべきか、acceptance criteria が十分かを判断する
- 人間は、実装前の Plan を承認、条件付き承認、差し戻し、却下する
- 人間は、validation evidence がプロダクトや運用リスクに対して十分かを判断する
- KC は、その判断が記録されているか、差分が scope 内か、必要 evidence があるかを検査する

KC は「誰が入力したか」を暗号学的に証明するものではありません。その代わり、GitHub Issue comment URL のような durable な human approval evidence を要求し、reviewer が判断履歴を追えるようにします。

## まず試す

公開済み CLI を確認します。

```bash
npx -y @sawadari/kc --help
```

既存 repo に KC テンプレートを追加します。

```bash
npx -y @sawadari/kc init --workspace .
```

これで `.kc` の example、GitHub templates、`AGENTS.md` のスターター、任意の Codex hook templates が配置されます。既存ファイルは `--force` を付けない限り上書きしません。

実際の PR では、example を有効な artifact にコピーして中身を埋めます。

```bash
cp .kc/issue.example.yaml .kc/issue.yaml
cp .kc/plan.example.yaml .kc/plan.yaml
cp .kc/approval.example.yaml .kc/approval.yaml
cp .kc/agent_envelope.example.yaml .kc/agent_envelope.yaml
cp .kc/evidence_bundle.example.yaml .kc/evidence_bundle.yaml
```

example は意図的に merge-ready ではありません。placeholder を実値に置き換え、実際の human approval evidence と verification / validation evidence を入れてから `PASS` を期待してください。

そのうえで deterministic check を実行します。

```bash
npx -y @sawadari/kc check --workspace .
```

`kc check` は `HOLD` または `FAIL` のとき終了コード `1` を返すため、CI の gate として使えます。

## 番号式の承認フロー

Codex 上で進める場合、KC は人間が番号で返せる approval brief を出せます。

```bash
npx -y @sawadari/kc approval-brief --workspace .
```

brief では次の選択肢を提示します。

1. Approve
2. Approve with conditions
3. Request changes
4. Reject

人間が番号で返答したら、その判断を GitHub Issue comment などの durable な場所にミラーします。その comment URL を `.kc/approval.yaml` に記録します。

```bash
npx -y @sawadari/kc approval-record \
  --workspace . \
  --choice 1 \
  --actor sawadari \
  --source github_issue_comment \
  --ref https://github.com/OWNER/REPO/issues/123#issuecomment-123456 \
  --summary "Approved the plan after reviewing scope and risks."
```

`approved` または `approved_with_conditions` なのに `human_approval.actor`, `human_approval.source`, `human_approval.ref` が無い場合、`kc check` は merge-ready にしません。

## GitHub Action に入れる

`.github/workflows/kc-guard.yml` を作ります。

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

Pull Request 上では、Action が KC artifact を読み、PR の変更ファイルが承認済み scope / prohibited path に反していないか確認し、Evidence Bundle を生成します。設定すれば PR コメントも投稿します。`main` push では current mode で、merge / release 後の台帳が stale でないか確認します。

よく使う Action inputs:

- `mode`: merge readiness 用の `pr`、または main 台帳確認用の `current`
- `artifact-name`: evidence artifact 名。未指定なら matrix / 複数jobで衝突しにくい一意名を生成する
- `evidence-output`: 生成 Evidence Bundle の出力先。GitHub Actions では未指定時 runner temp に出力する

Action outputs:

- `decision`: `PASS`, `WARN`, `HOLD`, `FAIL`
- `merge_ready`: `PASS` / `WARN` のとき `true`
- `primary_reason`: 主な reason code
- `findings_json`: findings の JSON
- `evidence_bundle_path`: 生成された Evidence Bundle の path

## 判定の意味

| Decision | 意味 | CI |
|---|---|---|
| `PASS` | 必要な KC 文脈があり、blocking finding がない | 成功 |
| `WARN` | merge は可能だが、reviewer が見るべき注意点がある | annotation 付きで成功 |
| `HOLD` | 重要な情報不足、または承認 scope 外の変更がある | 失敗 |
| `FAIL` | artifact または policy の状態が不正 | 失敗 |

## 日々の使い方

1. Issue に problem、expected outcome、acceptance criteria、non-goals を書く
2. agent に Plan を作らせ、`.kc/plan.yaml` に残す
3. 人間の承認を `.kc/approval.yaml` に残す
4. agent に承認済み scope の中で実装させる
5. verification / validation evidence を `.kc/evidence_bundle.yaml` に残す
6. ローカルまたは GitHub Actions で `kc check` を実行する
7. merge や release 完了後に `kc finalize` を実行し、証跡を閉じて `.kc/current.yaml` を inactive にする

これにより、「何を頼んだか」「何を承認したか」「何が変わったか」「何で確認したか」がチャット履歴ではなく repo に残ります。

## CLI

```bash
kc init --workspace .
kc check --workspace . --output .kc/evidence_bundle.generated.yaml
kc bundle --workspace . --output .kc/evidence_bundle.generated.yaml
kc assist --kind issue-packet --input issue.md --offline-template
kc issue-brief --input issue.md
kc issue-record --issue-ref URL --problem text --expected-outcome text --acceptance-criterion text --non-goal text --nrvv-file .kc/nrvv.yaml
kc issue-sync --issue-ref URL --workspace .
kc issue-sync --issue-ref URL --check --issue-file issue.md --workspace .
kc issue-check --workspace .
kc approval-brief --workspace .
kc approval-record --choice 1 --actor sawadari --source github_issue_comment --ref URL
kc change-request --target-plan-id PLAN-123 --reason "Need one extra file" --scope-addition src/new-path/**
kc finalize --workspace . --issue-ref URL --pr-ref URL --release-ref URL --npm-ref @scope/name@version --verify-external=public
kc close-work --workspace . --archive
kc check --workspace . --mode current
kc promote --workspace . --output-dir reports/promotion
```

コマンド概要:

- `kc init`: テンプレートを配置する。既存ファイルは上書きしない
- `kc check`: deterministic rules を実行し、`HOLD` / `FAIL` で失敗する。`--output` で生成 Evidence Bundle の出力先を選べる
- `kc bundle`: プロセスを失敗させずに Evidence Bundle を生成する。`--output` で出力先を選べる
- `kc assist`: candidate artifact を下書きする。AI 出力は最終判定を変えない
- `kc issue-brief`: issue の元メモを人間が埋める brief にする
- `kc issue-record`: 明示された issue 項目から `.kc/issue.yaml` を作る。`--nrvv-file` を使うと、構造化されたNRVV YAMLを `issue_packet.nrvv` に読み込める
- `kc issue-sync`: GitHub Issue body の見出しを決定的に解析し、`.kc/issue.yaml` の下書きを作る。`--check` でsource Issue候補と現在の `.kc/issue.yaml` のdriftを確認できる。`--issue-file` を使うとlocal Markdown sampleで比較できる
- `kc issue-check`: planning 前に issue artifact を検査する
- `kc approval-brief`: Issue、Plan、scope、risk、番号式の人間判断選択肢を表示する
- `kc approval-record`: 番号式の人間判断を `.kc/approval.yaml` に記録する
- `kc change-request`: 実装に承認済み plan scope 外のファイルが必要になったとき、`.kc/change_request.yaml` を作る
- `kc finalize`: merge / release 後に PR 時点の evidence を final 状態にする。public repo を認証なしで確認するなら `--verify-external=public`、意図的に認証済み `gh` を使うなら `--verify-external=authenticated`
- `kc close-work`: active な `.kc` artifact を archive し、現在作業を inactive にする
- `kc check --mode current`: main 上の stale な lifecycle 状態を検出する
- `kc promote`: DecisionLedger などの promotion candidate を人間 review 用に生成する

AI assist は任意です。`OPENAI_API_KEY` または `--openai-api-key` があるときだけ使います。deterministic check に API 認証情報は不要です。

## KC Artifacts

KC は対象 repo から次のファイルを読みます。

- `.kc/issue.yaml`: problem、expected outcome、acceptance criteria、任意のNRVV構造、risk tier、non-goals
- `.kc/plan.yaml`: 解釈した要求、実装 plan、allowed files、prohibited files
- `.kc/approval.yaml`: 人間の承認 evidence と承認条件
- `.kc/change_request.yaml`: 現在の plan に対する scope 追加の提案または承認
- `.kc/agent_envelope.yaml`: agent の識別子と実行境界
- `.kc/evidence_bundle.yaml`: verification、validation、PR、audit evidence
- `.kc/current.yaml`: 現在作業が active か finalized かを表す lifecycle 状態
- `.kc/ruleset.yaml`: 実行する rules と severity override
- `.kc/config.yaml`: GitHub Action の適用範囲設定

`kc init` で作る example は明示的かつ pending 状態です。active artifact に common placeholder が残っている場合、KC は merge-ready にしません。

`kc check` は canonical な `.kc/evidence_bundle.yaml` とは別に、生成 Evidence Bundle を書きます。ローカル既定値は `.kc/evidence_bundle.generated.yaml` で、KC template では ignore されます。別の場所へ出したい場合は `--output` を使います。GitHub Action では `evidence-output` を指定しない限り runner temp に出力します。

## IssueにおけるNRVV

KC Issueでは、必要に応じてNRVV構造を使えます。

- Need: 誰が、どの状況で、何に困っているか
- Requirement: システムまたはソフトウェアが満たすべき条件
- Verification: 各Requirementをどう確認するか
- Validation: 元のNeedが意図した文脈で満たされたことをどう確認するか

KCはVerificationとValidationを分けて扱います。テストが通ることはVerification evidenceにはなりますが、Validation passedを自動的には意味しません。

NRVVを使うと、KCは次を追跡できます。

```text
Need -> Requirement -> Verification evidence -> Validation evidence
```

これは、CodexなどのAIコーディングエージェントが素早くPRを作る場合に、変更が単にテストを通るだけでなく、元のNeedを満たしているかをレビューするために使います。NRVVはデフォルトでは任意です。Issueに`nrvv`がある場合、または`nrvv_required: true`を設定した場合、KCは不足しているtrace情報をwarning levelの`KC-NRVV-*` findingとして出します。

parserが読みやすいIssueにする場合は、RequirementとVerificationを次の形で書きます。

```md
## Requirement

- REQ-1: The upload flow shall retry transient HTTP 503 failures up to three times.

## Verification

- REQ-1: unit_test | HTTP 503 is retried up to three times | CI test report
```

より強いtraceabilityが必要な場合は、Plan itemとevidenceをRequirementへ明示的につなぎます。

```yaml
plan_items:
  - id: P1
    requirement_refs: [REQ-1]
    expected_files: [src/report/upload.ts]

verification_evidence:
  - evidence_id: VE-1
    type: unit_test
    requirement_refs: [REQ-1]
    ref: npm test
    status: passed
```

## Artifact Lifecycle

KC では、active な PR artifact と finalized evidence を分けて扱います。

- active artifact は、Codex と reviewer に「いま何が承認されているか」を伝える
- finalized artifact は、PR や release 完了後に「何が完了したか」を説明する

merge や release が完了したら `kc finalize` を使います。

```bash
kc finalize --workspace . \
  --issue-ref https://github.com/OWNER/REPO/issues/123 \
  --pr-ref https://github.com/OWNER/REPO/pull/456 \
  --release-ref https://github.com/OWNER/REPO/releases/tag/v1.2.3 \
  --npm-ref @scope/package@1.2.3
```

このコマンドは `.kc/evidence_bundle.yaml` を final 状態に更新し、`.kc/current.yaml` を書き、final bundle を `.kc/archive/` に保存します。

post-merge evidence の status は、参照を記録しただけか、外部状態まで確認したかを分けます。

- `recorded`: 参照を記録したが、KC は外部状態を独立確認していない
- `passed`: KC または release process が期待する外部状態を確認した
- `unverified`: 確認を試みたが期待状態を確認できなかった
- `failed`: 確認結果が期待状態と矛盾した

main や release branch 上で stale な状態を見つけたい場合は current mode を使います。

```bash
kc check --workspace . --mode current
```

PR mode では、過去の finalized work item の誤用も防ぎます。`.kc/current.yaml` が `active_work: false` または `lifecycle_state: finalized` の場合、`.kc` 以外を変更する新しい PR は、新しい `.kc/issue.yaml`、`.kc/plan.yaml`、`.kc/approval.yaml` を同じ PR で確立する必要があります。

active artifact を `.kc/archive/<work-id>/` に退避し、`.kc/current.yaml` に `active_work: false` を明示したい場合は `kc close-work --archive` を使います。

## Plan Change Request

実装中に、承認済み scope 外のファイル変更が必要だと分かった場合は、plan を黙って書き換えません。Plan Change Request を作り、人間の承認を取ります。

```bash
kc change-request --workspace . \
  --target-plan-id PLAN-123 \
  --reason "The approved API change also requires a generated client fixture." \
  --scope-addition tests/fixtures/client/**
```

`.kc/change_request.yaml` が `pending_approval` の間、その追加 scope に依存する変更は `HOLD` になります。人間が承認したら、artifact に `status: approved` と、durable な `human_approval.actor`、`human_approval.source`、`human_approval.ref` を記録します。その後 KC は、承認済み scope 追加を merge gate の対象として扱います。元の plan と scope 拡張の証跡は分けて残ります。

## Enforcement Scope

デフォルトでは、GitHub Action は全 PR に KC PR section を要求します。段階導入したい場合は `.kc/config.yaml` を追加します。

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

mode は `strict`, `opt_in`, `disabled` を指定できます。

## Ruleset

`.kc/ruleset.yaml` は実行される policy です。`ruleset.rules` で実行する KC-AE rules を制限し、`ruleset.severity_overrides` で rule ID ごとの severity を上書きできます。

```yaml
ruleset:
  rules:
    - KC-AE-001
    - KC-AE-007
  severity_overrides:
    KC-AE-007: warning
```

NRVV enforcementは、`ruleset.nrvv_profile` または `.kc/config.yaml` の `kc.nrvv.mode` でまとめて強められます。

```yaml
ruleset:
  nrvv_profile: optional # optional | warning | strict
```

`optional` は既定互換です。`warning` はNRVVがない場合もwarning findingを出します。`strict` は不足または不完全なNRVVをblocking findingにします。

現在の rules は、Issue 必須項目、validation scenario、Plan 承認、承認済み scope、prohibited files、verification evidence、verification / validation の分離、承認条件 evidence、agent audit refs、高リスク変更の rollback path、merge readiness、明示的な human approval evidence、placeholder 検出、risk-aware validation pending、plan item trace、current mode の lifecycle stale-state 検出、PR mode での過去 finalized artifact 誤用防止を扱います。

## 任意の Codex Hooks

KC は `templates/hooks/` に `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop` 向けの任意 hook template を同梱しています。

これらはローカル補助です。Codex hook 設定に明示的に組み込まない限り有効になりません。また、GitHub Action gate の代替ではありません。

## License

Apache-2.0。
