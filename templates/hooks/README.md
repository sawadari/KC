# KC Codex Hook Templates

These templates are optional local enforcement aids. They are not installed by `kc init` as active Codex configuration; copy or reference them from your Codex hook configuration only after reviewing the policy.

## Events

- `UserPromptSubmit`: blocks implementation intent when `.kc/approval.yaml` is missing or not approved.
- `PreToolUse` / `PermissionRequest`: blocks file edits when approval is missing, the target path is outside `approved_scope`, or the target path matches `prohibited_files`.
- `Stop`: blocks completion when code changed and `.kc/evidence_bundle.yaml` is missing.

## Example

```bash
KC_WORKSPACE=/path/to/repo \
KC_HOOK_EVENT=PreToolUse \
node templates/hooks/kc-codex-hook.mjs <<'JSON'
{
  "tool_name": "apply_patch",
  "tool_input": {
    "path": "src/auth/session.ts"
  }
}
JSON
```

The script emits JSON:

```json
{
  "decision": "block",
  "reason": "src/auth/session.ts matches prohibited_files. Create a Plan Change Request."
}
```

## Boundary

Hook payloads can differ across Codex environments. Bash or script-based edits may not expose every target path in a way the hook can inspect reliably, so these hooks are early local feedback rather than a complete enforcement layer.

Use the layers this way:

- Hooks: stop obvious local mistakes early.
- GitHub Action: run the deterministic merge gate on the PR.
- Humans: approve scope, validation meaning, and risk acceptance.

