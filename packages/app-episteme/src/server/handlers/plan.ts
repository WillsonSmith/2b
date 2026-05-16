import type { ServerWebSocket } from "bun";
import type { ClientMsg } from "../../protocol.ts";
import type { WsContext } from "../context.ts";

export type PlanMsg = Extract<
  ClientMsg,
  {
    type:
      | "plan_request"
      | "plan_from_document"
      | "plan_approve"
      | "plan_approve_step"
      | "plan_retry_step"
      | "plan_skip_step"
      | "plan_amend_steps"
      | "plan_edit_step_summary"
      | "plan_edit_step_instruction"
      | "plan_add_step"
      | "plan_reorder_step"
      | "plan_pause"
      | "plan_resume"
      | "plan_resume_auto"
      | "plan_cancel";
  }
>;

export async function handlePlan(
  msg: PlanMsg,
  ctx: WsContext,
  _ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { planning, send: _send } = ctx;

  switch (msg.type) {
    case "plan_request": {
      const goal = msg.goal?.trim();
      if (!goal) return;
      await planning.structurePlan(goal, msg.approvalMode ?? "all", undefined, msg.previousPlanId);
      return;
    }

    case "plan_from_document": {
      const goal = msg.goal?.trim();
      if (!goal) return;
      const absPath = ctx.resolveWorkspacePath(msg.path);
      if (!absPath) return;
      await planning.structurePlan(goal, msg.approvalMode ?? "all", absPath, msg.previousPlanId);
      return;
    }

    case "plan_approve":
      await planning.approvePlan(msg.planId);
      return;

    case "plan_approve_step":
      await planning.approveStep(msg.planId, msg.stepId);
      return;

    case "plan_retry_step":
      await planning.retryStep(msg.planId, msg.stepId);
      return;

    case "plan_skip_step":
      await planning.skipStep(msg.planId, msg.stepId);
      return;

    case "plan_amend_steps":
      await planning.amendSteps(msg.planId, msg.steps);
      return;

    case "plan_edit_step_summary":
      await planning.editStepSummary(msg.planId, msg.stepId, msg.summary);
      return;

    case "plan_edit_step_instruction":
      await planning.editStepInstruction(msg.planId, msg.stepId, msg.instruction);
      return;

    case "plan_add_step":
      await planning.addStep(msg.planId, msg.description, msg.insertAfterStepId);
      return;

    case "plan_reorder_step":
      planning.reorderStep(msg.planId, msg.stepId, msg.direction);
      return;

    case "plan_pause":
      planning.pause();
      return;

    case "plan_resume":
      await planning.resume();
      return;

    case "plan_resume_auto":
      await planning.resumeAuto();
      return;

    case "plan_cancel":
      planning.cancel();
      return;
  }
}
