import type { AgentPlugin } from "@2b/framework/core/Plugin.ts";
import type { WorkspaceDb } from "../db/workspaceDb.ts";
import type { EpistemePlan, PlanState } from "../planning/types.ts";

export class PlanningPlugin implements AgentPlugin {
  name = "Planning";

  private activePlan: EpistemePlan | null = null;
  private executingStepId: string | null = null;

  constructor(private workspaceDb: WorkspaceDb) {}

  onInit(): void {
    const plan = this.workspaceDb.getActivePlan();
    if (!plan) return;
    // Execution loop won't survive a server restart — move in-flight states to paused
    if (plan.state === "executing" || plan.state === "awaiting_step") {
      const recovered = plan.state === "awaiting_step" ? "awaiting_step" : "paused";
      const next: PlanState = recovered === "awaiting_step" ? "awaiting_step" : "paused";
      this.workspaceDb.updatePlanState(plan.id, next);
      this.activePlan = { ...plan, state: next };
    } else {
      this.activePlan = plan;
    }
  }

  setActivePlan(plan: EpistemePlan | null): void {
    this.activePlan = plan;
    this.executingStepId = null;
  }

  setExecutingStep(plan: EpistemePlan, stepId: string): void {
    this.activePlan = plan;
    this.executingStepId = stepId;
  }

  clearExecution(): void {
    this.executingStepId = null;
  }

  getActivePlan(): EpistemePlan | null {
    return this.activePlan;
  }

  getSystemPromptFragment(): string {
    if (!this.activePlan || this.activePlan.state !== "executing" || !this.executingStepId) {
      return "";
    }

    const plan = this.activePlan;
    const step = plan.steps.find(s => s.id === this.executingStepId);
    if (!step) return "";

    const completedSteps = plan.steps.filter(s => s.state === "complete");
    const stepNumber = step.index + 1;
    const total = plan.steps.length;

    const lines: string[] = [
      "## Active Plan Execution",
      `You are executing step ${stepNumber} of ${total} in a structured plan.`,
      `**Plan Goal:** ${plan.goal}`,
      `**Current Step:** [${step.type}] ${step.title}`,
      "",
      "Complete this step thoroughly. Your response will be recorded as the step result.",
    ];

    if (completedSteps.length > 0) {
      lines.push("", "**Context from completed steps:**");
      for (const s of completedSteps) {
        lines.push(`- [${s.type}] ${s.title}: ${s.contextSummary ?? "(completed)"}`);
      }
    }

    return lines.join("\n");
  }

  async getContext(): Promise<string> {
    if (!this.activePlan) return "";

    const plan = this.activePlan;
    const doneCount = plan.steps.filter(s => s.state === "complete" || s.state === "skipped").length;
    const total = plan.steps.length;

    const stateLabels: Record<string, string> = {
      structuring: "structuring plan",
      awaiting_approval: "awaiting your approval to start",
      awaiting_step: "awaiting step-by-step approval",
      executing: `executing (${doneCount}/${total} steps done)`,
      step_failed: "a step failed — awaiting user action",
      paused: "paused",
      complete: "complete",
      cancelled: "cancelled",
    };

    return `Active plan: "${plan.goal}" — ${stateLabels[plan.state] ?? plan.state}`;
  }
}
