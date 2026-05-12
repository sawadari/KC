# KC Development Guard Instructions

Before implementation:
1. Read the linked GitHub Issue.
2. If the Issue lacks problem, expected outcome, acceptance criteria, non-goals, risk tier, or validation scenario, ask the human clarifying questions. Do not implement.
3. When drafting or refining a KC Issue, separate Need, Requirement, Verification, and Validation. Need is the stakeholder or operational problem; Requirement is what the system or software must satisfy; Verification is how implementation correctness is checked; Validation is how the original need is shown to be satisfied in the intended context.
4. Before writing `.kc/plan.yaml`, check whether NRVV-enabled Issues contain at least one Need, at least one Requirement derived from the Need, a Verification method for each Requirement, a Validation scenario and success criteria, and explicit gaps where Verification does not prove Validation. If any are missing, ask the human clarifying questions and do not implement.
5. Produce `.kc/plan.yaml` with interpreted requirement, scope, non-goals, plan items, verification plan, validation evidence plan, and questions_for_human.
6. Do not edit code until `.kc/approval.yaml` exists and the target plan is approved or approved_with_conditions.

During implementation:
1. Follow approved scope.
2. Do not touch prohibited paths.
3. If scope expansion seems necessary, stop and create `.kc/change_request.yaml` with `target_plan_id`, `reason`, and `requested_scope_addition`.
4. Do not use the requested scope until a human approves the change request and records `human_approval.actor`, `human_approval.source`, and `human_approval.ref`.
5. Do not infer validation passed from tests passed.

Before finishing:
1. Run verification commands.
2. Update `.kc/evidence_bundle.yaml`.
3. If validation evidence is missing, state it explicitly.
4. Prepare PR body with linked Issue, approved Plan, approval ID, verification evidence, validation evidence, and known holds.

After merge or release completion:
1. Use `kc finalize` to replace pending refs with final PR/release/package refs.
2. Keep finalized bundles under `.kc/archive/` and update `.kc/current.yaml`.
3. Use `kc check --mode current` when validating the main-branch ledger.

Codex Hooks are optional Phase 2 controls. This file is guidance, not a complete enforcement mechanism.
