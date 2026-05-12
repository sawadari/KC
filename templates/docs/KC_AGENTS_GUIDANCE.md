# KC Agent Guidance Snippet

Use this file when your repository already has an `AGENTS.md` and you do not want KC to replace it.

`kc init` does not overwrite existing files unless `--force` is passed. If `AGENTS.md` already exists, keep your current file and copy only the KC guidance that fits your project.

Suggested KC additions:

- Before implementation, read `.kc/issue.yaml`, `.kc/plan.yaml`, and `.kc/approval.yaml`.
- Do not edit implementation files unless `.kc/approval.yaml` records an approved or approved_with_conditions decision with durable human approval evidence.
- Keep Need, Requirement, Verification, and Validation separate. Tests may support Verification, but they do not automatically prove Validation.
- If NRVV fields are missing, run `kc nrvv-candidate --workspace .` and ask the human to review the draft before planning.
- If implementation needs files outside the approved scope, create a Plan Change Request instead of editing first.
- Before PR review, run `kc check --workspace .` and attach verification and validation evidence.

Do not copy these bullets blindly if they conflict with stricter local repository policy. Treat them as KC-specific additions to your existing agent instructions.
