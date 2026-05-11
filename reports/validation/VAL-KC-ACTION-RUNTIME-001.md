# KC Action Runtime Validation

Date: 2026-05-12 JST

## Scope

Validate the GitHub Action runtime fix for Issue #38.

## Failure Reproduced

The sample repository `sawadari/kc-validation-sample` failed for both `sawadari/KC@v0` and `sawadari/KC@main` before the fix:

```text
ReferenceError: require is not defined in ES module scope
```

Root cause: the root package has `"type": "module"` while `dist/action/index.js` is bundled as CommonJS.

## Fix

Add `dist/action/package.json` with:

```json
{ "type": "commonjs" }
```

This keeps `action.yml` stable while making Node treat the bundled Action entrypoint as CommonJS.

## Checks

- `npm.cmd run check`: passed.
- `npm.cmd test`: passed, 32 tests.
- `npm.cmd run pack:dry`: passed.
- `npm.cmd run build; git diff --exit-code -- dist/action/index.js dist/action/package.json`: passed.
- Pending: sample repository `sawadari/KC@main` action validation after merge.

## Judgment

Local validation passed. Consumer-repository validation remains pending until this fix is available through `sawadari/KC@main`.
