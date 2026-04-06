import { test, expect, describe, mock } from "bun:test";
import { MetacognitionPlugin } from "./MetacognitionPlugin";
import { CortexMemoryPlugin } from "./CortexMemoryPlugin";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMemoryPlugin() {
  const llm = { getEmbedding: mock(async () => new Array(4).fill(0.1)) };
  return new CortexMemoryPlugin(llm as any, "test-meta", ":memory:");
}

function makeMetaPlugin(memPlugin = makeMemoryPlugin()) {
  const plugin = new MetacognitionPlugin(memPlugin);
  return { plugin, memPlugin };
}

/** Minimal TurnState-shaped object for injection into turnHistory. */
function makeTurn(
  markers: string[] = [],
  memAccesses = 0,
  toolNames: string[] = [],
  timestamp = new Date(),
) {
  return {
    turn_id: crypto.randomUUID(),
    started_at: timestamp,
    ended_at: timestamp,
    tool_calls: toolNames.map((name) => ({
      tool: name,
      args_summary: "",
      category: "memory" as const,
      timestamp,
    })),
    memory_access_count: memAccesses,
    external_tool_count: 0,
    behavioral_rules_active: [],
    uncertainty_markers: markers,
  };
}

// ── Phase 1: Directive escalation ─────────────────────────────────────────────

describe("getContext — directive escalation", () => {
  test("shows DIRECTIVE when only the current turn is saturated", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.uncertainty_markers = ["tool_saturation"];
    const ctx = (plugin as any).getContext();
    expect(ctx).toContain("DIRECTIVE:");
    expect(ctx).not.toContain("HARD STOP:");
  });

  test("escalates to HARD STOP when previous turn was also saturated", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).turnHistory = [makeTurn(["tool_saturation"])];
    (plugin as any).currentTurn.uncertainty_markers = ["tool_saturation"];
    const ctx = (plugin as any).getContext();
    expect(ctx).toContain("HARD STOP:");
  });

  test("no saturation directive emitted when no saturation marker present", () => {
    const { plugin } = makeMetaPlugin();
    const ctx = (plugin as any).getContext();
    expect(ctx).not.toContain("DIRECTIVE:");
    expect(ctx).not.toContain("HARD STOP:");
  });

  test("previous non-saturated turn does not trigger HARD STOP", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).turnHistory = [makeTurn([])]; // clean previous turn
    (plugin as any).currentTurn.uncertainty_markers = ["tool_saturation"];
    const ctx = (plugin as any).getContext();
    expect(ctx).toContain("DIRECTIVE:");
    expect(ctx).not.toContain("HARD STOP:");
  });
});

// ── Phase 2: Hard enforcement ─────────────────────────────────────────────────

describe("onBeforeToolCall — tool blocking", () => {
  test("allows all tools when blockedTools is empty", () => {
    const { plugin } = makeMetaPlugin();
    expect(plugin.onBeforeToolCall("search_memory", {})).toEqual({ allow: true });
    expect(plugin.onBeforeToolCall("hybrid_search", {})).toEqual({ allow: true });
    expect(plugin.onBeforeToolCall("query_memories", {})).toEqual({ allow: true });
    expect(plugin.onBeforeToolCall("web_search", {})).toEqual({ allow: true });
  });

  test("blocks search_memory once added to blockedTools", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).blockedTools.add("search_memory");
    const result = plugin.onBeforeToolCall("search_memory", {});
    expect(result.allow).toBe(false);
    expect((result as any).reason).toContain("[Metacognition]");
    expect((result as any).reason).toContain("search_memory");
  });

  test("blocks hybrid_search and query_memories when in blockedTools", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).blockedTools.add("hybrid_search");
    (plugin as any).blockedTools.add("query_memories");
    expect(plugin.onBeforeToolCall("hybrid_search", {}).allow).toBe(false);
    expect(plugin.onBeforeToolCall("query_memories", {}).allow).toBe(false);
  });

  test("does not block tools absent from the blocked set", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).blockedTools.add("search_memory");
    (plugin as any).blockedTools.add("hybrid_search");
    (plugin as any).blockedTools.add("query_memories");
    expect(plugin.onBeforeToolCall("web_search", {}).allow).toBe(true);
    expect(plugin.onBeforeToolCall("save_memory", {}).allow).toBe(true);
    expect(plugin.onBeforeToolCall("introspect", {}).allow).toBe(true);
  });

  test("clears blockedTools when a new user message arrives", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).blockedTools.add("search_memory");
    plugin.onMessage("user", "hello");
    expect(plugin.onBeforeToolCall("search_memory", {})).toEqual({ allow: true });
  });

  test("block reason includes the current memory access count and threshold", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.memory_access_count = 7;
    (plugin as any).blockedTools.add("search_memory");
    const result = plugin.onBeforeToolCall("search_memory", {}) as { allow: false; reason: string };
    expect(result.reason).toContain("7");  // access count
    expect(result.reason).toContain("5");  // default threshold
  });
});

// ── Phase 1: Pattern detection and rule persistence ───────────────────────────

describe("maybeAutoCorrect — pattern detection", () => {
  test("saves saturation rule when 3+ of last 5 turns are saturated", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    (plugin as any).turnHistory = [
      ...Array.from({ length: 3 }, () => makeTurn(["tool_saturation"], 6)),
      ...Array.from({ length: 2 }, () => makeTurn()),
    ];

    await (plugin as any).maybeAutoCorrect();

    const saved = memPlugin.db.queryMemories({ types: ["behavior"], tags: ["metacognition-correction"] });
    expect(saved.length).toBeGreaterThanOrEqual(1);
    expect(saved[0].text).toContain("search_memory");
  });

  test("saves redundancy rule when 3+ of last 5 turns have duplicate tool calls", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    (plugin as any).turnHistory = [
      ...Array.from({ length: 3 }, () => makeTurn([], 0, ["search_memory", "search_memory"])),
      ...Array.from({ length: 2 }, () => makeTurn()),
    ];

    await (plugin as any).maybeAutoCorrect();

    const saved = memPlugin.db.queryMemories({ types: ["behavior"], tags: ["metacognition-correction"] });
    expect(saved.some((m) => m.text.includes("once per turn"))).toBe(true);
  });

  test("saves hedged_no_search rule when 3+ of last 5 turns hedged without memory access", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    (plugin as any).turnHistory = [
      ...Array.from({ length: 3 }, () => makeTurn(["hedged_language"], 0)),
      ...Array.from({ length: 2 }, () => makeTurn()),
    ];

    await (plugin as any).maybeAutoCorrect();

    const saved = memPlugin.db.queryMemories({ types: ["behavior"], tags: ["metacognition-correction"] });
    expect(saved.some((m) => m.text.includes("hedging"))).toBe(true);
  });

  test("does not save rule when fewer than threshold turns match the pattern", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    // 2 saturated turns — below threshold of 3
    (plugin as any).turnHistory = [
      ...Array.from({ length: 2 }, () => makeTurn(["tool_saturation"])),
      ...Array.from({ length: 3 }, () => makeTurn()),
    ];

    await (plugin as any).maybeAutoCorrect();

    const saved = memPlugin.db.queryMemories({ types: ["behavior"], tags: ["metacognition-correction"] });
    expect(saved.length).toBe(0);
  });

  test("skips saving a duplicate when a correction for the same trigger was saved recently", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    (plugin as any).turnHistory = Array.from({ length: 3 }, () =>
      makeTurn(["tool_saturation"], 6),
    );

    await (plugin as any).maybeAutoCorrect();
    const count1 = memPlugin.db.queryMemories({ types: ["behavior"], tags: ["metacognition-correction"] }).length;

    // Second call — deduplication should prevent another write
    await (plugin as any).maybeAutoCorrect();
    const count2 = memPlugin.db.queryMemories({ types: ["behavior"], tags: ["metacognition-correction"] }).length;

    expect(count2).toBe(count1);
  });

  test("records the correction in correctionHistory with effectiveness: pending", async () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).turnHistory = Array.from({ length: 3 }, () =>
      makeTurn(["tool_saturation"], 6),
    );

    await (plugin as any).maybeAutoCorrect();

    const history = (plugin as any).correctionHistory as Array<{ trigger: string; effectiveness: string }>;
    expect(history.length).toBe(1);
    expect(history[0].trigger).toBe("saturation");
    expect(history[0].effectiveness).toBe("pending");
  });

  test("does not trigger when turnHistory has fewer than PATTERN_THRESHOLD entries", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    // Only 2 entries — below the threshold of 3
    (plugin as any).turnHistory = [
      makeTurn(["tool_saturation"]),
      makeTurn(["tool_saturation"]),
    ];

    await (plugin as any).maybeAutoCorrect();

    const saved = memPlugin.db.queryMemories({ types: ["behavior"], tags: ["metacognition-correction"] });
    expect(saved.length).toBe(0);
  });
});

// ── Phase 1: show_corrections tool ───────────────────────────────────────────

describe("show_corrections tool", () => {
  test("returns a no-corrections message when history is empty", async () => {
    const { plugin } = makeMetaPlugin();
    const result = await plugin.executeTool("show_corrections", {});
    expect(result).toContain("No self-corrections");
  });

  test("lists correction entries with trigger and effectiveness", async () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).correctionHistory = [
      {
        id: "aaaaaaaa-test",
        trigger: "saturation",
        rule_saved: "Do not re-search excessively",
        behavior_memory_id: "bbbbbbbb",
        applied_at: new Date(),
        turns_observed: 5,
        effectiveness: "effective",
      },
    ];
    const result = await plugin.executeTool("show_corrections", {});
    expect(result).toContain("saturation");
    expect(result).toContain("effective");
    expect(result).toContain("Do not re-search");
  });

  test("summary header reflects counts by effectiveness status", async () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).correctionHistory = [
      { id: "a", trigger: "saturation", rule_saved: "r1", behavior_memory_id: "x", applied_at: new Date(), turns_observed: 3, effectiveness: "effective" },
      { id: "b", trigger: "redundancy", rule_saved: "r2", behavior_memory_id: "y", applied_at: new Date(), turns_observed: 3, effectiveness: "ineffective" },
      { id: "c", trigger: "hedged_no_search", rule_saved: "r3", behavior_memory_id: "z", applied_at: new Date(), turns_observed: 3, effectiveness: "pending" },
    ];
    const result = await plugin.executeTool("show_corrections", {});
    expect(result).toContain("1 effective");
    expect(result).toContain("1 ineffective");
    expect(result).toContain("1 pending");
  });
});

// ── Phase 3: Correction effectiveness tracking ───────────────────────────────

describe("checkCorrectionEffectiveness", () => {
  test("marks correction ineffective when pattern recurs after correction", async () => {
    const { plugin } = makeMetaPlugin();
    const correctionDate = new Date(Date.now() - 1000);
    (plugin as any).correctionHistory = [{
      id: "test-1",
      trigger: "saturation",
      rule_saved: "original rule",
      behavior_memory_id: "fake-id",
      applied_at: correctionDate,
      turns_observed: 5,
      effectiveness: "pending",
    }];

    const afterDate = new Date();
    (plugin as any).turnHistory = [
      makeTurn(["tool_saturation"], 6, [], afterDate),
      makeTurn(["tool_saturation"], 7, [], afterDate),
    ];

    await (plugin as any).checkCorrectionEffectiveness();

    expect((plugin as any).correctionHistory[0].effectiveness).toBe("ineffective");
  });

  test("strengthens behavior memory in DB when correction is marked ineffective", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    const behaviorId = await memPlugin.db.addMemory(
      "original rule",
      "behavior",
      ["metacognition-correction", "saturation"],
    );

    const correctionDate = new Date(Date.now() - 1000);
    (plugin as any).correctionHistory = [{
      id: "test-2",
      trigger: "saturation",
      rule_saved: "original rule",
      behavior_memory_id: behaviorId,
      applied_at: correctionDate,
      turns_observed: 5,
      effectiveness: "pending",
    }];

    const afterDate = new Date();
    (plugin as any).turnHistory = [makeTurn(["tool_saturation"], 6, [], afterDate)];

    await (plugin as any).checkCorrectionEffectiveness();

    const memories = memPlugin.db.queryMemories({ types: ["behavior"] });
    const updated = memories.find((m: { id: string }) => m.id === behaviorId) as { text: string } | undefined;
    expect(updated?.text).toContain("CRITICAL");
    expect(updated?.text).toContain("original rule");
  });

  test("updates correctionHistory rule_saved to reflect the strengthened text", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    const behaviorId = await memPlugin.db.addMemory("original rule", "behavior", []);
    const correctionDate = new Date(Date.now() - 1000);
    (plugin as any).correctionHistory = [{
      id: "test-2b",
      trigger: "redundancy",
      rule_saved: "original rule",
      behavior_memory_id: behaviorId,
      applied_at: correctionDate,
      turns_observed: 5,
      effectiveness: "pending",
    }];

    const afterDate = new Date();
    (plugin as any).turnHistory = [
      makeTurn([], 0, ["search_memory", "search_memory"], afterDate),
    ];

    await (plugin as any).checkCorrectionEffectiveness();

    expect((plugin as any).correctionHistory[0].rule_saved).toContain("CRITICAL");
  });

  test("marks correction effective when pattern is absent for 10+ turns", async () => {
    const { plugin } = makeMetaPlugin();
    const correctionDate = new Date(Date.now() - 1000);
    (plugin as any).correctionHistory = [{
      id: "test-3",
      trigger: "saturation",
      rule_saved: "some rule",
      behavior_memory_id: "fake-id",
      applied_at: correctionDate,
      turns_observed: 5,
      effectiveness: "pending",
    }];

    const afterDate = new Date();
    (plugin as any).turnHistory = Array.from({ length: 10 }, () =>
      makeTurn([], 1, [], afterDate),
    );

    await (plugin as any).checkCorrectionEffectiveness();

    expect((plugin as any).correctionHistory[0].effectiveness).toBe("effective");
  });

  test("prunes stale effective correction from DB when older than 30 days", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    const behaviorId = await memPlugin.db.addMemory(
      "old rule",
      "behavior",
      ["metacognition-correction", "saturation"],
    );

    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    (plugin as any).correctionHistory = [{
      id: "test-4",
      trigger: "saturation",
      rule_saved: "old rule",
      behavior_memory_id: behaviorId,
      applied_at: staleDate,
      turns_observed: 5,
      effectiveness: "pending",
    }];

    const afterDate = new Date(staleDate.getTime() + 1000);
    (plugin as any).turnHistory = Array.from({ length: 10 }, () =>
      makeTurn([], 1, [], afterDate),
    );

    await (plugin as any).checkCorrectionEffectiveness();

    expect((plugin as any).correctionHistory[0].effectiveness).toBe("effective");
    const remaining = memPlugin.db.queryMemories({ types: ["behavior"] });
    expect(remaining.find((m: { id: string }) => m.id === behaviorId)).toBeUndefined();
  });

  test("does not prune effective correction younger than 30 days", async () => {
    const { plugin, memPlugin } = makeMetaPlugin();
    const behaviorId = await memPlugin.db.addMemory(
      "fresh rule",
      "behavior",
      ["metacognition-correction", "saturation"],
    );

    const recentDate = new Date(Date.now() - 1000);
    (plugin as any).correctionHistory = [{
      id: "test-5",
      trigger: "saturation",
      rule_saved: "fresh rule",
      behavior_memory_id: behaviorId,
      applied_at: recentDate,
      turns_observed: 5,
      effectiveness: "pending",
    }];

    const afterDate = new Date();
    (plugin as any).turnHistory = Array.from({ length: 10 }, () =>
      makeTurn([], 1, [], afterDate),
    );

    await (plugin as any).checkCorrectionEffectiveness();

    expect((plugin as any).correctionHistory[0].effectiveness).toBe("effective");
    const remaining = memPlugin.db.queryMemories({ types: ["behavior"] });
    expect(remaining.find((m: { id: string }) => m.id === behaviorId)).toBeDefined();
  });

  test("skips corrections already resolved (not re-evaluated)", async () => {
    const { plugin } = makeMetaPlugin();
    const correctionDate = new Date(Date.now() - 1000);
    (plugin as any).correctionHistory = [{
      id: "test-6",
      trigger: "saturation",
      rule_saved: "some rule",
      behavior_memory_id: "fake-id",
      applied_at: correctionDate,
      turns_observed: 5,
      effectiveness: "effective", // already resolved
    }];

    const afterDate = new Date();
    // Pattern recurs — but should be ignored since correction is already resolved
    (plugin as any).turnHistory = [makeTurn(["tool_saturation"], 6, [], afterDate)];

    await (plugin as any).checkCorrectionEffectiveness();

    expect((plugin as any).correctionHistory[0].effectiveness).toBe("effective");
  });

  test("leaves correction pending when no turns exist after it was applied", async () => {
    const { plugin } = makeMetaPlugin();
    const correctionDate = new Date(Date.now() + 5000); // in the future
    (plugin as any).correctionHistory = [{
      id: "test-7",
      trigger: "saturation",
      rule_saved: "some rule",
      behavior_memory_id: "fake-id",
      applied_at: correctionDate,
      turns_observed: 5,
      effectiveness: "pending",
    }];
    (plugin as any).turnHistory = [makeTurn([], 0, [], new Date())]; // turn is before correction

    await (plugin as any).checkCorrectionEffectiveness();

    expect((plugin as any).correctionHistory[0].effectiveness).toBe("pending");
  });

  test("patternRecurredIn correctly detects redundancy pattern", () => {
    const { plugin } = makeMetaPlugin();
    const redundantTurn = makeTurn([], 0, ["search_memory", "search_memory"]);
    const cleanTurn = makeTurn([], 0, ["search_memory"]);

    expect((plugin as any).patternRecurredIn("redundancy", [redundantTurn])).toBe(true);
    expect((plugin as any).patternRecurredIn("redundancy", [cleanTurn])).toBe(false);
  });

  test("patternRecurredIn correctly detects hedged_no_search pattern", () => {
    const { plugin } = makeMetaPlugin();
    const hedgedTurn = makeTurn(["hedged_language"], 0);
    const hedgedWithSearch = makeTurn(["hedged_language"], 2);
    const cleanTurn = makeTurn([], 0);

    expect((plugin as any).patternRecurredIn("hedged_no_search", [hedgedTurn])).toBe(true);
    expect((plugin as any).patternRecurredIn("hedged_no_search", [hedgedWithSearch])).toBe(false);
    expect((plugin as any).patternRecurredIn("hedged_no_search", [cleanTurn])).toBe(false);
  });
});

// ── Improvement C: User uncertainty detection ─────────────────────────────────

describe("onMessage('user') — user uncertainty detection", () => {
  test("pushes 'user_query_uncertain' when message matches pattern", () => {
    const { plugin } = makeMetaPlugin();
    plugin.onMessage("user", "I'm not sure how this works");
    expect((plugin as any).currentTurn.uncertainty_markers).toContain("user_query_uncertain");
  });

  test("does not push marker when message has no uncertainty signals", () => {
    const { plugin } = makeMetaPlugin();
    plugin.onMessage("user", "Tell me about Paris");
    expect((plugin as any).currentTurn.uncertainty_markers).not.toContain("user_query_uncertain");
  });

  test("marker is on the new turn, not the archived previous turn", () => {
    const { plugin } = makeMetaPlugin();
    // Simulate a completed turn so there is something to archive
    (plugin as any).currentTurn.tool_calls.push({ tool: "search_memory", args_summary: "", category: "memory", timestamp: new Date() });
    plugin.onMessage("user", "I don't know if this is right");
    const archived: any[] = (plugin as any).turnHistory;
    expect(archived.length).toBe(1);
    expect(archived[0].uncertainty_markers).not.toContain("user_query_uncertain");
    expect((plugin as any).currentTurn.uncertainty_markers).toContain("user_query_uncertain");
  });

  test("marker is absent after next user message with no uncertainty", () => {
    const { plugin } = makeMetaPlugin();
    plugin.onMessage("user", "I'm not sure about this");
    expect((plugin as any).currentTurn.uncertainty_markers).toContain("user_query_uncertain");
    // Next user message (new turn)
    (plugin as any).currentTurn.tool_calls.push({ tool: "search_memory", args_summary: "", category: "memory", timestamp: new Date() });
    plugin.onMessage("user", "What is the capital of France?");
    expect((plugin as any).currentTurn.uncertainty_markers).not.toContain("user_query_uncertain");
  });
});

describe("getContext — user_query_uncertain directive", () => {
  test("emits directive when marker is present", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.uncertainty_markers = ["user_query_uncertain"];
    const ctx = (plugin as any).getContext();
    expect(ctx).toContain("DIRECTIVE: User query contains uncertainty signals");
  });

  test("does not emit directive when marker is absent", () => {
    const { plugin } = makeMetaPlugin();
    const ctx = (plugin as any).getContext();
    expect(ctx).not.toContain("User query contains uncertainty signals");
  });

  test("both user_query_uncertain and hedged_language directives appear simultaneously", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.uncertainty_markers = ["user_query_uncertain", "hedged_language"];
    const ctx = (plugin as any).getContext();
    expect(ctx).toContain("User query contains uncertainty signals");
    expect(ctx).toContain("You hedged your last response");
  });
});

// ── Improvement A: Graduated saturation warning ───────────────────────────────

describe("getContext — approaching saturation warning", () => {
  test("no approaching-saturation line when count is below warning threshold", () => {
    // threshold=8, warningThreshold=ceil(8*0.6)=5; count=4 → below
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.memory_access_count = 4;
    const ctx = (plugin as any).getContext();
    expect(ctx).not.toContain("APPROACHING SATURATION");
  });

  test("emits approaching-saturation line when count >= warningThreshold and not yet saturated", () => {
    // threshold=8, warningThreshold=5; count=5 → at threshold, not saturated
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.memory_access_count = 5;
    const ctx = (plugin as any).getContext();
    expect(ctx).toContain("APPROACHING SATURATION");
    expect(ctx).toContain("5/8");
  });

  test("does NOT emit approaching-saturation when already saturated; DIRECTIVE appears instead", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.memory_access_count = 9;
    (plugin as any).currentTurn.uncertainty_markers = ["tool_saturation"];
    const ctx = (plugin as any).getContext();
    expect(ctx).not.toContain("APPROACHING SATURATION");
    expect(ctx).toContain("DIRECTIVE:");
  });

  test("approaching-saturation line includes correct count/threshold values", () => {
    const { plugin } = makeMetaPlugin();
    (plugin as any).currentTurn.memory_access_count = 6;
    const ctx = (plugin as any).getContext();
    expect(ctx).toContain("6/8");
  });
});
