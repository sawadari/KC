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
          comment-on-linked-issue: false
```

Pull Request 上では、Action が KC artifact を読み、PR の変更ファイルが承認済み scope / prohibited path に反していないか確認し、Evidence Bundle を生成します。設定すれば PR コメントも投稿します。

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

これにより、「何を頼んだか」「何を承認したか」「何が変わったか」「何で確認したか」がチャット履歴ではなく repo に残ります。

## CLI

```bash
kc init --workspace .
kc check --workspace .
kc bundle --workspace .
kc assist --kind issue-packet --input issue.md --offline-template
kc issue-brief --input issue.md
kc issue-record --issue-ref URL --problem text --expected-outcome text --acceptance-criterion text --non-goal text
kc issue-check --workspace .
kc approval-brief --workspace .
kc approval-record --choice 1 --actor sawadari --source github_issue_comment --ref URL
kc promote --workspace . --output-dir reports/promotion
```

コマンド概要:

- `kc init`: テンプレートを配置する。既存ファイルは上書きしない
- `kc check`: deterministic rules を実行し、`HOLD` / `FAIL` で失敗する
- `kc bundle`: プロセスを失敗させずに Evidence Bundle を生成する
- `kc assist`: candidate artifact を下書きする。AI 出力は最終判定を変えない
- `kc issue-brief`: issue の元メモを人間が埋める brief にする
- `kc issue-record`: 明示された issue 項目から `.kc/issue.yaml` を作る
- `kc issue-check`: planning 前に issue artifact を検査する
- `kc approval-brief`: Issue、Plan、scope、risk、番号式の人間判断選択肢を表示する
- `kc approval-record`: 番号式の人間判断を `.kc/approval.yaml` に記録する
- `kc promote`: DecisionLedger などの promotion candidate を人間 review 用に生成する

AI assist は任意です。`OPENAI_API_KEY` または `--openai-api-key` があるときだけ使います。deterministic check に API 認証情報は不要です。

## KC Artifacts

KC は対象 repo から次のファイルを読みます。

- `.kc/issue.yaml`: problem、expected outcome、acceptance criteria、risk tier、non-goals
- `.kc/plan.yaml`: 解釈した要求、実装 plan、allowed files、prohibited files
- `.kc/approval.yaml`: 人間の承認 evidence と承認条件
- `.kc/agent_envelope.yaml`: agent の識別子と実行境界
- `.kc/evidence_bundle.yaml`: verification、validation、PR、audit evidence
- `.kc/ruleset.yaml`: 実行する rules と severity override
- `.kc/config.yaml`: GitHub Action の適用範囲設定

`kc init` で作る example は明示的かつ pending 状態です。active artifact に common placeholder が残っている場合、KC は merge-ready にしません。

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

現在の rules は、Issue 必須項目、validation scenario、Plan 承認、承認済み scope、prohibited files、verification evidence、verification / validation の分離、承認条件 evidence、agent audit refs、高リスク変更の rollback path、merge readiness、明示的な human approval evidence、placeholder 検出、risk-aware validation pending、plan item trace を扱います。

## 任意の Codex Hooks

KC は `templates/hooks/` に `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop` 向けの任意 hook template を同梱しています。

これらはローカル補助です。Codex hook 設定に明示的に組み込まない限り有効になりません。また、GitHub Action gate の代替ではありません。

## License

Apache-2.0。
