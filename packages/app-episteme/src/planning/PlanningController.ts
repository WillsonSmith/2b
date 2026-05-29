import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import type { LLMProvider } from "@2b/framework/providers/llm/LLMProvider.ts";
import type { CortexAgent } from "@2b/framework/core/CortexAgent.ts";
import { logger } from "@2b/framework/logger.ts";
import type { WorkspaceDb } from "../db/workspaceDb.ts";
import type { ServerMsg } from "../protocol.ts";
import type { PlanningPlugin } from "../plugins/PlanningPlugin.ts";
import type {
  EpistemePlan,
  EpistemePlanStep,
  EpistemePlanStepType,
  PlanStepDraft,
} from "./types.ts";

const STRUCTURING_SYSTEM = `You are a planning assistant for Episteme, a Markdown research and writing tool.
Given a user's goal, produce a plan as ordered steps. Each step has a type, a short title, and a detailed, self-contained instruction.

Step types:
- research: Find information, search sources, gather context from the workspace
- outline: Create document structure or section layout
- draft: Write new content
- edit: Revise or improve existing content
- cite: Add citations, references, or bibliography
- analyze: Examine, compare, or synthesize information
- organize: Move, rename, or restructure files or sections

Guidelines:
- 3-7 steps is ideal for most tasks
- Each instruction must be self-contained and actionable
- Steps must build on each other logically`;

const SUMMARIZE_SYSTEM = `You are a concise summarizer for a multi-step research and writing plan. Write 2-3 sentences capturing what was concretely accomplished. Prioritize: specific file paths created or modified, document titles or section headings produced, key decisions made, concrete numbers or named entities discovered, and any explicit outputs a later step should build on. Return only the summary, no preamble or labels.`;

const STEP_GENERATOR_SYSTEM = `You are a planning assistant for Episteme, a Markdown research and writing tool.
Given a plan goal, its existing steps, and a short description of a new step to add, generate a well-formed step with a type, a short title, and a detailed instruction.
Valid types: research, outline, draft, edit, cite, analyze, organize.
The instruction must be actionable and consistent with the surrounding steps in the plan.`;

/**
 * Step types as a tuple kept exhaustively in lockstep with
 * `EpistemePlanStepType`. The `Record<EpistemePlanStepType, true>` forces every
 * union member to be listed (missing one is a compile error) and rejects any
 * value that isn't a valid step type. `STEP_TYPES` then feeds `z.enum`, so the
 * schema's `type` field is exactly `EpistemePlanStepType`.
 */
const STEP_TYPE_TABLE: Record<EpistemePlanStepType, true> = {
  research: true,
  outline: true,
  draft: true,
  edit: true,
  cite: true,
  analyze: true,
  organize: true,
};

const STEP_TYPES = Object.keys(STEP_TYPE_TABLE) as [
  EpistemePlanStepType,
  ...EpistemePlanStepType[],
];

/**
 * One plan step as the structurer/step-generator must return it. Used with
 * `askStructured`: the enum replaces the `VALID_STEP_TYPES` coercion, and the
 * model can no longer emit an unknown `type`.
 */
export const planStepSchema = z.object({
  type: z.enum(STEP_TYPES),
  title: z.string(),
  instruction: z.string(),
});

/**
 * Full structured-plan response. `.min(1)` enforces "at least one step" at
 * parse time, replacing the manual `steps.length === 0` check.
 */
export const planSchema = z.object({
  steps: z.array(planStepSchema).min(1),
});

const PRIOR_CONTEXT_RECENT_STEPS = 2;
const PRIOR_CONTEXT_EXCERPT_CHARS = 800;

export class PlanningController {
  private callInProgress = false;
  private paused = false;
  private cancelled = false;
  private structurer: HeadlessAgent;
  private summarizer: HeadlessAgent;
  private stepGenerator: HeadlessAgent;

  constructor(
    llm: LLMProvider,
    private agent: CortexAgent,
    private planningPlugin: PlanningPlugin,
    private workspaceDb: WorkspaceDb,
    private broadcast: (msg: ServerMsg) => void,
  ) {
    this.structurer = new HeadlessAgent(llm, [], STRUCTURING_SYSTEM, { agentName: "PlanStructurer" });
    this.summarizer = new HeadlessAgent(llm, [], SUMMARIZE_SYSTEM, { agentName: "PlanSummarizer" });
    this.stepGenerator = new HeadlessAgent(llm, [], STEP_GENERATOR_SYSTEM, { agentName: "PlanStepGenerator" });
  }

  /** True while the agent is processing a plan step — server should reject user `send` messages. */
  get isLocked(): boolean {
    return this.callInProgress;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async structurePlan(
    goal: string,
    approvalMode: "all" | "per_step",
    triggerDocument?: string,
    previousPlanId?: string,
  ): Promise<void> {
    this.broadcast({ type: "state_change", state: "structuring" });

    // Build prior context from the previous plan's completed steps
    let priorContext: string | undefined;
    if (previousPlanId) {
      const prev = this.workspaceDb.getPlan(previousPlanId);
      if (prev) {
        const completedSteps = prev.steps.filter(s => s.state === "complete" && s.contextSummary);
        if (completedSteps.length > 0) {
          const lines = [`Previous plan: "${prev.goal}"`, "Steps completed:"];
          const recentCutoff = completedSteps.length - PRIOR_CONTEXT_RECENT_STEPS;
          for (let i = 0; i < completedSteps.length; i++) {
            const s = completedSteps[i]!;
            if (i < recentCutoff || !s.fullResult) {
              lines.push(`- [${s.type}] ${s.title}: ${s.contextSummary}`);
            } else {
              const excerpt = s.fullResult.slice(0, PRIOR_CONTEXT_EXCERPT_CHARS);
              const truncated = s.fullResult.length > PRIOR_CONTEXT_EXCERPT_CHARS ? "…" : "";
              lines.push(`- [${s.type}] ${s.title}: ${s.contextSummary}`);
              lines.push(`  <detail>${excerpt}${truncated}</detail>`);
            }
          }
          priorContext = lines.join("\n");
        }
      }
    }

    let prompt = `Goal: ${goal}`;
    if (priorContext) {
      prompt += `\n\n${priorContext}`;
    }
    if (triggerDocument) {
      try {
        const content = await Bun.file(triggerDocument).text();
        prompt += `\n\nDocument path: ${triggerDocument}\nCurrent content:\n${content.slice(0, 3000)}`;
      } catch {
        // proceed without document content
      }
    }
    prompt += "\n\nCreate a step-by-step plan.";

    // askStructured constrains the model to planSchema and validates the result:
    // the enum guarantees a valid `type`, and `.min(1)` rejects an empty plan —
    // so invalid JSON, a bad step type, and a step-less plan all surface here as
    // a thrown error. Reset to idle and rethrow on any of them.
    let parsed: z.infer<typeof planSchema>;
    try {
      parsed = await this.structurer.askStructured(prompt, planSchema);
    } catch (err) {
      logger.error("PlanningController", `structuring failed: ${err}`);
      this.broadcast({ type: "state_change", state: "idle" });
      throw err;
    }

    const planId = randomUUID();
    const now = Date.now();
    const steps: EpistemePlanStep[] = parsed.steps.map((s, i) => ({
      id: randomUUID(),
      planId,
      index: i,
      type: s.type,
      title: s.title,
      instruction: s.instruction,
      state: "pending",
    }));

    const plan: EpistemePlan = {
      id: planId,
      goal,
      state: "awaiting_approval",
      approvalMode,
      trigger: triggerDocument ? "document" : "user_goal",
      triggerDocument,
      priorContext,
      steps,
      createdAt: now,
    };

    this.workspaceDb.createPlan(plan);
    this.planningPlugin.setActivePlan(plan);
    this.broadcast({ type: "plan_created", plan });
    this.broadcast({ type: "state_change", state: "awaiting_approval" });
  }

  async approvePlan(planId: string): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan || plan.state !== "awaiting_approval") return;

    this.cancelled = false;
    this.paused = false;

    if (plan.approvalMode === "all") {
      const now = Date.now();
      this.workspaceDb.updatePlanState(planId, "executing", { startedAt: now });
      const updated = this.workspaceDb.getPlan(planId)!;
      this.planningPlugin.setActivePlan(updated);
      this.broadcast({ type: "plan_updated", plan: updated });
      this.broadcast({ type: "state_change", state: "executing" });
      this.runAllSteps(updated).catch(err => logger.error("PlanningController", `runAllSteps: ${err}`));
    } else {
      const firstStep = plan.steps[0];
      if (!firstStep) {
        this.finishPlan(plan);
        return;
      }
      this.workspaceDb.updatePlanStep(firstStep.id, { state: "awaiting_approval" });
      this.workspaceDb.updatePlanState(planId, "awaiting_step", { startedAt: Date.now() });
      const updated = this.workspaceDb.getPlan(planId)!;
      this.planningPlugin.setActivePlan(updated);
      this.broadcast({ type: "plan_updated", plan: updated });
      this.broadcast({ type: "state_change", state: "awaiting_step" });
    }
  }

  async approveStep(planId: string, stepId: string): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan || plan.state !== "awaiting_step") return;

    const step = plan.steps.find(s => s.id === stepId && s.state === "awaiting_approval");
    if (!step) return;

    this.cancelled = false;
    this.paused = false;

    this.workspaceDb.updatePlanState(planId, "executing");
    const updated = this.workspaceDb.getPlan(planId)!;
    this.planningPlugin.setActivePlan(updated);
    this.broadcast({ type: "state_change", state: "executing" });

    this.runStep(updated, step)
      .then(() => this.advancePerStep(planId))
      .catch(err => logger.error("PlanningController", `approveStep: ${err}`));
  }

  async editStepInstruction(planId: string, stepId: string, instruction: string): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan) return;
    const step = plan.steps.find(s => s.id === stepId && s.state === "awaiting_approval");
    if (!step) return;

    this.workspaceDb.updatePlanStep(stepId, { instruction });
    const updated = this.workspaceDb.getPlan(planId)!;
    this.planningPlugin.setActivePlan(updated);
    this.broadcast({ type: "plan_updated", plan: updated });
  }

  async editStepSummary(planId: string, stepId: string, summary: string): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan) return;
    const step = plan.steps.find(s => s.id === stepId && s.state === "complete");
    if (!step) return;

    this.workspaceDb.updatePlanStep(stepId, { contextSummary: summary });
    const updated = this.workspaceDb.getPlan(planId)!;
    this.planningPlugin.setActivePlan(updated);
    this.broadcast({ type: "plan_updated", plan: updated });
  }

  async addStep(planId: string, description: string, insertAfterStepId?: string | null): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan || (plan.state !== "awaiting_approval" && plan.state !== "awaiting_step")) return;

    const stepList = plan.steps
      .map((s, i) => `${i + 1}. [${s.type}] ${s.title}: ${s.instruction.slice(0, 120)}`)
      .join("\n");

    // Build position context so the generator can write a well-targeted instruction
    let positionContext = "";
    if (insertAfterStepId === null) {
      const nextStep = plan.steps[0];
      positionContext = nextStep
        ? `\nPosition: This step will be the FIRST step, running before "${nextStep.title}". Write the instruction accordingly.`
        : `\nPosition: This will be the only step in the plan.`;
    } else if (insertAfterStepId !== undefined) {
      const afterIdx = plan.steps.findIndex(s => s.id === insertAfterStepId);
      const prevStep = plan.steps[afterIdx];
      const nextStep = plan.steps[afterIdx + 1];
      if (prevStep && nextStep) {
        positionContext = `\nPosition: This step will be inserted between "${prevStep.title}" (step ${afterIdx + 1}) and "${nextStep.title}" (step ${afterIdx + 2}). Write the instruction to bridge these two steps naturally.`;
      } else if (prevStep) {
        positionContext = `\nPosition: This step will run after "${prevStep.title}" (step ${afterIdx + 1}), at the end of the plan.`;
      }
    } else {
      const lastStep = plan.steps[plan.steps.length - 1];
      if (lastStep) {
        positionContext = `\nPosition: This step will be appended at the END, running after "${lastStep.title}".`;
      }
    }

    const prompt = `Plan goal: ${plan.goal}\n\nExisting steps:\n${stepList}\n\nDescription for new step: ${description}${positionContext}\n\nGenerate a step object.`;

    let parsed: z.infer<typeof planStepSchema>;
    try {
      parsed = await this.stepGenerator.askStructured(prompt, planStepSchema);
    } catch (err) {
      logger.error("PlanningController", `addStep generation failed: ${err}`);
      throw err;
    }

    // Determine insertion index
    let insertIndex: number;
    if (insertAfterStepId === null) {
      insertIndex = 0;
    } else if (insertAfterStepId !== undefined) {
      const afterIdx = plan.steps.findIndex(s => s.id === insertAfterStepId);
      insertIndex = afterIdx === -1 ? plan.steps.length : afterIdx + 1;
    } else {
      insertIndex = plan.steps.length;
    }

    const newStep: EpistemePlanStep = {
      id: randomUUID(),
      planId,
      index: insertIndex,
      type: parsed.type,
      title: parsed.title,
      instruction: parsed.instruction,
      state: "pending",
    };

    const spliced = [...plan.steps];
    spliced.splice(insertIndex, 0, newStep);
    const reindexed = spliced.map((s, i) => ({ ...s, index: i }));

    this.workspaceDb.replacePlanSteps(planId, reindexed);
    const updated = this.workspaceDb.getPlan(planId)!;
    this.planningPlugin.setActivePlan(updated);
    this.broadcast({ type: "plan_updated", plan: updated });
  }

  reorderStep(planId: string, stepId: string, direction: "up" | "down"): void {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan || plan.state !== "awaiting_approval") return;

    const idx = plan.steps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= plan.steps.length) return;

    const reordered = [...plan.steps];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx]!, reordered[idx]!];
    const reindexed = reordered.map((s, i) => ({ ...s, index: i }));

    this.workspaceDb.replacePlanSteps(planId, reindexed);
    const updated = this.workspaceDb.getPlan(planId)!;
    this.planningPlugin.setActivePlan(updated);
    this.broadcast({ type: "plan_updated", plan: updated });
  }

  async amendSteps(planId: string, drafts: PlanStepDraft[]): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan || plan.state !== "awaiting_approval") return;

    const newSteps: EpistemePlanStep[] = drafts.map((d, i) => ({
      id: randomUUID(),
      planId,
      index: i,
      type: d.type,
      title: d.title,
      instruction: d.instruction,
      state: "pending",
    }));

    this.workspaceDb.replacePlanSteps(planId, newSteps);
    const updated = this.workspaceDb.getPlan(planId)!;
    this.planningPlugin.setActivePlan(updated);
    this.broadcast({ type: "plan_updated", plan: updated });
  }

  async retryStep(planId: string, stepId: string): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan || plan.state !== "step_failed") return;

    const step = plan.steps.find(s => s.id === stepId && s.state === "failed");
    if (!step) return;

    this.cancelled = false;
    this.paused = false;

    this.workspaceDb.updatePlanStep(stepId, { state: "pending", error: undefined, fullResult: undefined, contextSummary: undefined });
    this.workspaceDb.updatePlanState(planId, "executing");
    const refreshed = this.workspaceDb.getPlan(planId)!;
    const retryStep = refreshed.steps.find(s => s.id === stepId)!;

    this.planningPlugin.setActivePlan(refreshed);
    this.broadcast({ type: "state_change", state: "executing" });

    if (plan.approvalMode === "all") {
      this.runStep(refreshed, retryStep)
        .then(() => this.runAllSteps(this.workspaceDb.getPlan(planId)!))
        .catch(err => logger.error("PlanningController", `retryStep: ${err}`));
    } else {
      this.runStep(refreshed, retryStep)
        .then(() => this.advancePerStep(planId))
        .catch(err => logger.error("PlanningController", `retryStep: ${err}`));
    }
  }

  async skipStep(planId: string, stepId: string): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId);
    if (!plan || plan.state !== "step_failed") return;

    this.workspaceDb.updatePlanStep(stepId, { state: "skipped" });

    if (plan.approvalMode === "all") {
      this.workspaceDb.updatePlanState(planId, "executing");
      const updated = this.workspaceDb.getPlan(planId)!;
      this.planningPlugin.setActivePlan(updated);
      this.broadcast({ type: "state_change", state: "executing" });
      this.runAllSteps(updated).catch(err => logger.error("PlanningController", `skipStep: ${err}`));
    } else {
      await this.advancePerStep(planId);
    }
  }

  pause(): void {
    this.paused = true;
    // Takes effect after the current step completes; use cancel() for immediate stop
  }

  async resume(): Promise<void> {
    const plan = this.workspaceDb.getActivePlan();
    if (!plan || plan.state !== "paused") return;

    this.paused = false;
    this.cancelled = false;

    if (plan.approvalMode === "all") {
      this.workspaceDb.updatePlanState(plan.id, "executing");
      const updated = this.workspaceDb.getPlan(plan.id)!;
      this.planningPlugin.setActivePlan(updated);
      this.broadcast({ type: "plan_updated", plan: updated });
      this.broadcast({ type: "state_change", state: "executing" });
      this.runAllSteps(updated).catch(err => logger.error("PlanningController", `resume: ${err}`));
    } else {
      const nextPending = plan.steps.find(s => s.state === "pending");
      if (!nextPending) {
        this.finishPlan(plan);
        return;
      }
      this.workspaceDb.updatePlanStep(nextPending.id, { state: "awaiting_approval" });
      this.workspaceDb.updatePlanState(plan.id, "awaiting_step");
      const updated = this.workspaceDb.getPlan(plan.id)!;
      this.planningPlugin.setActivePlan(updated);
      this.broadcast({ type: "plan_updated", plan: updated });
      this.broadcast({ type: "state_change", state: "awaiting_step" });
    }
  }

  async resumeAuto(): Promise<void> {
    const plan = this.workspaceDb.getActivePlan();
    if (!plan || !["paused", "awaiting_step"].includes(plan.state)) return;

    this.paused = false;
    this.cancelled = false;

    // Any step waiting for per-step approval must go back to pending so runAllSteps picks it up
    const waitingStep = plan.steps.find(s => s.state === "awaiting_approval");
    if (waitingStep) {
      this.workspaceDb.updatePlanStep(waitingStep.id, { state: "pending" });
    }

    this.workspaceDb.updatePlanState(plan.id, "executing");
    const updated = this.workspaceDb.getPlan(plan.id)!;
    this.planningPlugin.setActivePlan(updated);
    this.broadcast({ type: "plan_updated", plan: updated });
    this.broadcast({ type: "state_change", state: "executing" });
    this.runAllSteps(updated).catch(err => logger.error("PlanningController", `resumeAuto: ${err}`));
  }

  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    this.agent.interrupt();

    const plan = this.workspaceDb.getActivePlan();
    if (plan) {
      this.workspaceDb.updatePlanState(plan.id, "cancelled");
      const cancelled = { ...plan, state: "cancelled" as const };
      this.planningPlugin.setActivePlan(null);
      this.broadcast({ type: "plan_updated", plan: cancelled });
    }
    this.broadcast({ type: "state_change", state: "idle" });
  }

  // ── Internal execution ─────────────────────────────────────────────────────

  private async runAllSteps(plan: EpistemePlan): Promise<void> {
    let current = plan;

    while (!this.cancelled && !this.paused) {
      const nextStep = current.steps.find(s => s.state === "pending");
      if (!nextStep) {
        this.finishPlan(current);
        return;
      }

      try {
        await this.runStep(current, nextStep);
      } catch {
        // runStep already updated state to step_failed and broadcast
        return;
      }

      if (this.cancelled || this.paused) break;
      current = this.workspaceDb.getPlan(current.id)!;
    }

    if (this.paused && !this.cancelled) {
      this.workspaceDb.updatePlanState(plan.id, "paused");
      const paused = this.workspaceDb.getPlan(plan.id)!;
      this.planningPlugin.setActivePlan(paused);
      this.planningPlugin.clearExecution();
      this.broadcast({ type: "plan_updated", plan: paused });
      this.broadcast({ type: "state_change", state: "paused" });
    }
  }

  private async advancePerStep(planId: string): Promise<void> {
    const plan = this.workspaceDb.getPlan(planId)!;
    const nextPending = plan.steps.find(s => s.state === "pending");

    if (!nextPending) {
      this.finishPlan(plan);
      return;
    }

    this.workspaceDb.updatePlanStep(nextPending.id, { state: "awaiting_approval" });
    this.workspaceDb.updatePlanState(planId, "awaiting_step");
    const updated = this.workspaceDb.getPlan(planId)!;
    this.planningPlugin.setActivePlan(updated);
    this.planningPlugin.clearExecution();
    this.broadcast({ type: "plan_updated", plan: updated });
    this.broadcast({ type: "state_change", state: "awaiting_step" });
  }

  private async runStep(plan: EpistemePlan, step: EpistemePlanStep): Promise<void> {
    const now = Date.now();
    this.workspaceDb.updatePlanStep(step.id, { state: "running", startedAt: now });
    const runningPlan = this.workspaceDb.getPlan(plan.id)!;
    const runningStep = runningPlan.steps.find(s => s.id === step.id)!;

    this.planningPlugin.setExecutingStep(runningPlan, step.id);
    this.broadcast({ type: "plan_step_started", planId: plan.id, stepId: step.id });

    try {
      const fullResult = await this.callAgent(runningStep.instruction);
      const contextSummary = await this.summarize(runningStep.title, fullResult);

      this.workspaceDb.updatePlanStep(step.id, {
        state: "complete",
        fullResult,
        contextSummary,
        completedAt: Date.now(),
      });

      const completedPlan = this.workspaceDb.getPlan(plan.id)!;
      this.planningPlugin.setActivePlan(completedPlan);
      this.workspaceDb.appendChatEvent({
        role: "plan_step",
        planId: plan.id,
        stepId: step.id,
        stepTitle: step.title,
        stepType: step.type,
        state: "complete",
        summary: contextSummary,
      });
      this.broadcast({ type: "plan_step_completed", planId: plan.id, stepId: step.id, summary: contextSummary });
    } catch (err) {
      if (this.cancelled) return;
      const error = err instanceof Error ? err.message : String(err);
      this.workspaceDb.updatePlanStep(step.id, { state: "failed", error });
      this.workspaceDb.updatePlanState(plan.id, "step_failed");
      const failedPlan = this.workspaceDb.getPlan(plan.id)!;
      this.planningPlugin.setActivePlan(failedPlan);
      this.planningPlugin.clearExecution();
      this.workspaceDb.appendChatEvent({
        role: "plan_step",
        planId: plan.id,
        stepId: step.id,
        stepTitle: step.title,
        stepType: step.type,
        state: "failed",
        error,
      });
      this.broadcast({ type: "plan_step_failed", planId: plan.id, stepId: step.id, error });
      this.broadcast({ type: "state_change", state: "step_failed" });
      throw err;
    }
  }

  private finishPlan(plan: EpistemePlan): void {
    const completedAt = Date.now();
    this.workspaceDb.updatePlanState(plan.id, "complete", { completedAt });
    const completed = { ...plan, state: "complete" as const };
    this.planningPlugin.setActivePlan(null);
    this.planningPlugin.clearExecution();

    const summary = this.buildCompletionSummary(plan, completedAt);
    this.workspaceDb.appendChatMessage("assistant", summary);
    this.broadcast({ type: "speak", text: summary });

    this.broadcast({ type: "plan_complete", planId: plan.id });
    this.broadcast({ type: "plan_updated", plan: completed });
    this.broadcast({ type: "state_change", state: "idle" });
  }

  private buildCompletionSummary(plan: EpistemePlan, completedAt: number): string {
    const sorted = [...plan.steps].sort((a, b) => a.index - b.index);
    const completedSteps = sorted.filter(s => s.state === "complete");
    const skippedSteps = sorted.filter(s => s.state === "skipped");

    const lines: string[] = [`**Plan complete:** "${plan.goal}"`, ""];

    for (const step of completedSteps) {
      lines.push(`**${step.index + 1}. ${step.title}** — ${step.contextSummary ?? "Completed."}`);
    }
    for (const step of skippedSteps) {
      lines.push(`**${step.index + 1}. ${step.title}** — *(skipped)*`);
    }

    const footerParts = [`${completedSteps.length}/${plan.steps.length} steps completed`];
    if (plan.startedAt) {
      const secs = Math.round((completedAt - plan.startedAt) / 1000);
      footerParts.push(secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`);
    }
    lines.push("", `_${footerParts.join(" · ")}_`);

    return lines.join("\n\n");
  }

  private callAgent(instruction: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buffer = "";
      let seenThinking = false;

      const onSpeak: (r: string) => void = (text) => {
        buffer += (buffer ? "\n" : "") + text;
      };
      const onState: (s: "idle" | "thinking") => void = (state) => {
        if (state === "thinking") {
          seenThinking = true;
        } else if (state === "idle" && seenThinking) {
          cleanup();
          resolve(buffer);
        }
      };
      const onError: (err: Error) => void = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        this.agent.off("state_change", onState);
        this.agent.off("speak", onSpeak);
        this.agent.off("error", onError);
      };

      this.callInProgress = true;
      this.agent.on("state_change", onState);
      this.agent.on("speak", onSpeak);
      this.agent.on("error", onError);

      this.agent.addDirect(instruction);
    }).finally(() => {
      this.callInProgress = false;
    });
  }

  private async summarize(stepTitle: string, result: string): Promise<string> {
    try {
      const summary = await this.summarizer.ask(
        `Step: "${stepTitle}"\n\nResult:\n${result.slice(0, 4000)}`,
      );
      return summary.trim();
    } catch {
      return `${stepTitle}: completed.`;
    }
  }
}
