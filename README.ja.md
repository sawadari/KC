# KC

KC は、Codex + GitHub の開発フローを配布可能な Knowledge Convergence guard にするためのツールです。

Issue の目的、Codex の Plan、人間の承認、verification evidence、validation evidence、PR 差分を読み、merge してよい知識状態かを deterministic rule で判定します。

AI 出力は承認ではありません。AI assist は不足質問、Plan 草案、Evidence Bundle 草案、PR 説明を作れますが、gate の最終判定は常に機械的ルールだけで決まります。

## 使い方

```bash
npx @sawadari/kc init --workspace .
npx @sawadari/kc check --workspace .
```

GitHub Actions:

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

`kc check` は `HOLD` または `FAIL` のとき終了コード `1` を返します。`kc bundle` は Evidence Bundle を生成しますが、判定でプロセスを失敗させません。

AI assist は `OPENAI_API_KEY` または `--openai-api-key` がある場合だけ動きます。deterministic check には認証情報は不要です。

## 読み取る artifact

- `.kc/issue.yaml`
- `.kc/plan.yaml`
- `.kc/approval.yaml`
- `.kc/agent_envelope.yaml`
- `.kc/evidence_bundle.yaml`
- `.kc/ruleset.yaml`

`kc init` はテンプレートと GitHub 用テンプレートを配置します。既存ファイルは `--force` がない限り上書きしません。

## 判定

- `PASS`: merge-ready
- `WARN`: 注意付きで merge 可能
- `HOLD`: 解消または明示判断まで merge すべきでない
- `FAIL`: artifact 不正または policy 違反

## ライセンス

Apache-2.0。
