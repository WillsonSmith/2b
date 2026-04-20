import { test, expect, describe } from "bun:test";
import { PlanPlugin } from "./PlanPlugin";

function makePlugin(): PlanPlugin {
  return new PlanPlugin(":memory:");
}

// ── Registration ───────────────────────────────────────────────────────────────

describe("PlanPlugin - registration", () => {
  test("exposes five tools", () => {
    const plugin = makePlugin();
    const names = plugin.getTools().map(t => t.name);
    expect(names).toContain("create_plan");
    expect(names).toContain("update_step");
    expect(names).toContain("complete_plan");
    expect(names).toContain("abandon_plan");
    expect(names).toContain("get_plan");
    expect(names).toHaveLength(5);
  });

  test("getSystemPromptFragment mentions all five tools", () => {
    const fragment = makePlugin().getSystemPromptFragment();
    ["create_plan", "update_step", "complete_plan", "abandon_plan", "get_plan"].forEach(t => {
      expect(fragment).toContain(t);
    });
  });

  test("executeTool returns undefined for unknown tool name", async () => {
    const result = await makePlugin().executeTool("unknown", {});
    expect(result).toBeUndefined();
  });
});

// ── create_plan ────────────────────────────────────────────────────────────────

describe("create_plan", () => {
  test("creates a plan with steps and returns formatted output", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("create_plan", {
      goal: "Build a feature",
      steps: ["Design API", "Implement", "Write tests"],
    }) as string;
    expect(result).toContain("Build a feature");
    expect(result).toContain("Design API");
    expect(result).toContain("Implement");
    expect(result).toContain("Write tests");
  });

  test("plan is accessible via getActivePlan()", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "My goal", steps: ["step 1", "step 2"] });
    const plan = plugin.getActivePlan();
    expect(plan).not.toBeNull();
    expect(plan!.goal).toBe("My goal");
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.status).toBe("active");
  });

  test("steps are ordered by position", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "Ordered", steps: ["first", "second", "third"] });
    const plan = plugin.getActivePlan()!;
    expect(plan.steps[0]!.description).toBe("first");
    expect(plan.steps[1]!.description).toBe("second");
    expect(plan.steps[2]!.description).toBe("third");
  });

  test("all new steps start as pending", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["a", "b"] });
    const plan = plugin.getActivePlan()!;
    expect(plan.steps.every(s => s.status === "pending")).toBe(true);
  });

  test("creating a second plan abandons the first", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "First", steps: ["step"] });
    const firstId = plugin.getActivePlan()!.id;
    await plugin.executeTool("create_plan", { goal: "Second", steps: ["step"] });
    const firstPlan = plugin.getPlanById(firstId)!;
    expect(firstPlan.status).toBe("abandoned");
    const active = plugin.getActivePlan()!;
    expect(active.goal).toBe("Second");
  });

  test("returns error when goal is empty", async () => {
    const result = await makePlugin().executeTool("create_plan", { goal: "", steps: ["x"] }) as string;
    expect(result).toContain("goal is required");
  });

  test("returns error when steps is empty array", async () => {
    const result = await makePlugin().executeTool("create_plan", { goal: "G", steps: [] }) as string;
    expect(result).toContain("non-empty array");
  });

  test("returns error when steps is missing", async () => {
    const result = await makePlugin().executeTool("create_plan", { goal: "G" }) as string;
    expect(result).toContain("non-empty array");
  });
});

// ── update_step ────────────────────────────────────────────────────────────────

describe("update_step", () => {
  async function planWithSteps() {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["step A", "step B"] });
    return plugin;
  }

  test("updates step status to in_progress", async () => {
    const plugin = await planWithSteps();
    const stepId = plugin.getActivePlan()!.steps[0]!.id;
    const result = await plugin.executeTool("update_step", { step_id: stepId, status: "in_progress" }) as string;
    expect(result).toContain("in_progress");
    expect(plugin.getActivePlan()!.steps[0]!.status).toBe("in_progress");
  });

  test("updates step status to done", async () => {
    const plugin = await planWithSteps();
    const stepId = plugin.getActivePlan()!.steps[0]!.id;
    await plugin.executeTool("update_step", { step_id: stepId, status: "done" });
    expect(plugin.getActivePlan()!.steps[0]!.status).toBe("done");
  });

  test("stores notes on the step", async () => {
    const plugin = await planWithSteps();
    const stepId = plugin.getActivePlan()!.steps[0]!.id;
    await plugin.executeTool("update_step", { step_id: stepId, status: "failed", notes: "timeout error" });
    expect(plugin.getActivePlan()!.steps[0]!.notes).toBe("timeout error");
  });

  test("matches step by 8-char prefix", async () => {
    const plugin = await planWithSteps();
    const fullId = plugin.getActivePlan()!.steps[1]!.id;
    const prefix = fullId.slice(0, 8);
    await plugin.executeTool("update_step", { step_id: prefix, status: "skipped" });
    expect(plugin.getActivePlan()!.steps[1]!.status).toBe("skipped");
  });

  test("returns error for invalid status", async () => {
    const plugin = await planWithSteps();
    const stepId = plugin.getActivePlan()!.steps[0]!.id;
    const result = await plugin.executeTool("update_step", { step_id: stepId, status: "unknown" }) as string;
    expect(result).toContain("invalid status");
  });

  test("returns error when step_id not found", async () => {
    const plugin = await planWithSteps();
    const result = await plugin.executeTool("update_step", { step_id: "nonexistent", status: "done" }) as string;
    expect(result).toContain("no step found");
  });

  test("returns error when step_id is missing", async () => {
    const plugin = await planWithSteps();
    const result = await plugin.executeTool("update_step", { status: "done" }) as string;
    expect(result).toContain("step_id is required");
  });
});

// ── complete_plan ──────────────────────────────────────────────────────────────

describe("complete_plan", () => {
  test("marks active plan as completed", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["s"] });
    const id = plugin.getActivePlan()!.id;
    const result = await plugin.executeTool("complete_plan", {}) as string;
    expect(result).toContain("completed");
    expect(plugin.getPlanById(id)!.status).toBe("completed");
  });

  test("no active plan after completion", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["s"] });
    await plugin.executeTool("complete_plan", {});
    expect(plugin.getActivePlan()).toBeNull();
  });

  test("returns message when no active plan", async () => {
    const result = await makePlugin().executeTool("complete_plan", {}) as string;
    expect(result).toContain("No active plan");
  });
});

// ── abandon_plan ───────────────────────────────────────────────────────────────

describe("abandon_plan", () => {
  test("marks active plan as abandoned", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["s"] });
    const id = plugin.getActivePlan()!.id;
    await plugin.executeTool("abandon_plan", {});
    expect(plugin.getPlanById(id)!.status).toBe("abandoned");
  });

  test("includes reason in result string", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["s"] });
    const result = await plugin.executeTool("abandon_plan", { reason: "scope changed" }) as string;
    expect(result).toContain("scope changed");
  });

  test("returns message when no active plan", async () => {
    const result = await makePlugin().executeTool("abandon_plan", {}) as string;
    expect(result).toContain("No active plan");
  });
});

// ── get_plan ───────────────────────────────────────────────────────────────────

describe("get_plan", () => {
  test("returns active plan when no plan_id given", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "Show me", steps: ["a", "b"] });
    const result = await plugin.executeTool("get_plan", {}) as string;
    expect(result).toContain("Show me");
    expect(result).toContain("a");
    expect(result).toContain("b");
  });

  test("returns plan by ID", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "Specific plan", steps: ["step 1"] });
    const id = plugin.getActivePlan()!.id;
    await plugin.executeTool("complete_plan", {});
    const result = await plugin.executeTool("get_plan", { plan_id: id }) as string;
    expect(result).toContain("Specific plan");
  });

  test("returns 'No active plan' when DB is empty", async () => {
    const result = await makePlugin().executeTool("get_plan", {}) as string;
    expect(result).toContain("No active plan");
  });

  test("returns error for unknown plan ID", async () => {
    const result = await makePlugin().executeTool("get_plan", { plan_id: "00000000-0000-0000-0000-000000000000" }) as string;
    expect(result).toContain("No plan found");
  });
});

// ── getContext ─────────────────────────────────────────────────────────────────

describe("getContext", () => {
  test("returns empty string when no active plan", async () => {
    const ctx = await makePlugin().getContext();
    expect(ctx).toBe("");
  });

  test("returns formatted active plan in context", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "Context goal", steps: ["do X", "do Y"] });
    const ctx = await plugin.getContext();
    expect(ctx).toContain("Active plan:");
    expect(ctx).toContain("Context goal");
    expect(ctx).toContain("do X");
    expect(ctx).toContain("do Y");
  });

  test("context reflects step status updates", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["first step"] });
    const stepId = plugin.getActivePlan()!.steps[0]!.id;
    await plugin.executeTool("update_step", { step_id: stepId, status: "done" });
    const ctx = await plugin.getContext();
    expect(ctx).toContain("done");
  });

  test("context is empty after plan completion", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("create_plan", { goal: "G", steps: ["s"] });
    await plugin.executeTool("complete_plan", {});
    const ctx = await plugin.getContext();
    expect(ctx).toBe("");
  });
});
