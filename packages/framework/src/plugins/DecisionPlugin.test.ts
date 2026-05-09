import { test, expect, describe, mock } from "bun:test";
import { DecisionPlugin } from "./DecisionPlugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeLLM(response = "Option 1:\n  Pros: fast\n  Cons: none\n\nRecommendation: Option 1\nRationale: It is faster."): LLMProvider {
  return {
    chat: mock(async () => ({
      response,
      nonReasoningContent: response,
      reasoningContent: "",
      reasoningText: "",
    })),
    embed: mock(async () => []),
  } as unknown as LLMProvider;
}

function makePlugin(chatResponse?: string): DecisionPlugin {
  return new DecisionPlugin(makeLLM(chatResponse), ":memory:");
}

// ── Registration ───────────────────────────────────────────────────────────────

describe("DecisionPlugin - registration", () => {
  test("exposes three tools", () => {
    const names = makePlugin().getTools().map(t => t.name);
    expect(names).toContain("evaluate_options");
    expect(names).toContain("record_decision");
    expect(names).toContain("get_decision_history");
    expect(names).toHaveLength(3);
  });

  test("getSystemPromptFragment mentions all three tools", () => {
    const fragment = makePlugin().getSystemPromptFragment();
    ["evaluate_options", "record_decision", "get_decision_history"].forEach(t => {
      expect(fragment).toContain(t);
    });
  });

  test("executeTool returns undefined for unknown tool name", async () => {
    expect(await makePlugin().executeTool("unknown", {})).toBeUndefined();
  });
});

// ── evaluate_options ───────────────────────────────────────────────────────────

describe("evaluate_options", () => {
  test("calls LLM and returns analysis wrapping the question", async () => {
    const plugin = makePlugin("Option A:\n  Pros: cheap\n  Cons: slow\n\nRecommendation: Option A\nRationale: Budget matters.");
    const result = await plugin.executeTool("evaluate_options", {
      question: "Which database to use?",
      options: ["Option A", "Option B"],
    }) as string;
    expect(result).toContain("Which database to use?");
    expect(result).toContain("Option A");
    expect(result).toContain("Recommendation");
  });

  test("includes context in the LLM prompt when provided", async () => {
    const llm = makeLLM();
    const chatMock = llm.chat as ReturnType<typeof mock>;
    const plugin = new DecisionPlugin(llm, ":memory:");
    await plugin.executeTool("evaluate_options", {
      question: "Pick a framework",
      options: ["React", "Vue"],
      context: "We have strong React expertise on the team.",
    });
    const prompt = chatMock.mock.calls[0]![0][0].content as string;
    expect(prompt).toContain("React expertise");
  });

  test("returns error when fewer than two options provided", async () => {
    const result = await makePlugin().executeTool("evaluate_options", {
      question: "Q",
      options: ["only one"],
    }) as string;
    expect(result).toContain("at least two options");
  });

  test("returns error when question is empty", async () => {
    const result = await makePlugin().executeTool("evaluate_options", {
      question: "",
      options: ["A", "B"],
    }) as string;
    expect(result).toContain("question is required");
  });

  test("returns error message when LLM throws", async () => {
    const llm = {
      chat: mock(async () => { throw new Error("LLM down"); }),
      embed: mock(async () => []),
    } as unknown as LLMProvider;
    const plugin = new DecisionPlugin(llm, ":memory:");
    const result = await plugin.executeTool("evaluate_options", {
      question: "Q",
      options: ["A", "B"],
    }) as string;
    expect(result).toContain("LLM call failed");
    expect(result).toContain("LLM down");
  });

  test("does not persist a decision automatically", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("evaluate_options", { question: "Q", options: ["A", "B"] });
    expect(plugin.getHistory()).toHaveLength(0);
  });
});

// ── record_decision ────────────────────────────────────────────────────────────

describe("record_decision", () => {
  test("persists decision and returns confirmation string", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("record_decision", {
      question: "Which language?",
      chosen_option: "TypeScript",
      rationale: "Strong typing reduces runtime errors.",
      options_considered: ["JavaScript", "TypeScript"],
    }) as string;
    expect(result).toContain("Decision recorded");
    expect(result).toContain("TypeScript");
    expect(result).toContain("Strong typing");
  });

  test("stored decision is retrievable via getHistory()", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("record_decision", {
      question: "Framework choice",
      chosen_option: "React",
      rationale: "Team familiarity.",
    });
    const history = plugin.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.chosenOption).toBe("React");
    expect(history[0]!.question).toBe("Framework choice");
  });

  test("options_considered defaults to [chosen_option] when omitted", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("record_decision", {
      question: "Q",
      chosen_option: "X",
      rationale: "Because X.",
    });
    const history = plugin.getHistory();
    expect(history[0]!.optionsConsidered).toEqual(["X"]);
  });

  test("result contains the returned decision ID", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("record_decision", {
      question: "Q",
      chosen_option: "Y",
      rationale: "R",
    }) as string;
    expect(result).toMatch(/id: [0-9a-f-]{36}/);
  });

  test("getById returns stored record", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("record_decision", {
      question: "Q",
      chosen_option: "A",
      rationale: "R",
    }) as string;
    const id = result.match(/id: ([0-9a-f-]{36})/)![1]!;
    const record = plugin.getById(id);
    expect(record).not.toBeNull();
    expect(record!.chosenOption).toBe("A");
  });

  test("returns error when question is empty", async () => {
    const result = await makePlugin().executeTool("record_decision", {
      question: "",
      chosen_option: "X",
      rationale: "R",
    }) as string;
    expect(result).toContain("question is required");
  });

  test("returns error when chosen_option is empty", async () => {
    const result = await makePlugin().executeTool("record_decision", {
      question: "Q",
      chosen_option: "",
      rationale: "R",
    }) as string;
    expect(result).toContain("chosen_option is required");
  });

  test("returns error when rationale is empty", async () => {
    const result = await makePlugin().executeTool("record_decision", {
      question: "Q",
      chosen_option: "X",
      rationale: "",
    }) as string;
    expect(result).toContain("rationale is required");
  });
});

// ── get_decision_history ───────────────────────────────────────────────────────

describe("get_decision_history", () => {
  async function pluginWithDecisions(n: number): Promise<DecisionPlugin> {
    const plugin = makePlugin();
    for (let i = 0; i < n; i++) {
      await plugin.executeTool("record_decision", {
        question: `Question ${i}`,
        chosen_option: `Option ${i}`,
        rationale: `Because ${i}.`,
        options_considered: [`Option ${i}`, `Other ${i}`],
      });
    }
    return plugin;
  }

  test("returns 'No decisions' when history is empty", async () => {
    const result = await makePlugin().executeTool("get_decision_history", {}) as string;
    expect(result).toContain("No decisions recorded yet");
  });

  test("returns all stored decisions when within limit", async () => {
    const plugin = await pluginWithDecisions(3);
    const result = await plugin.executeTool("get_decision_history", { limit: 10 }) as string;
    expect(result).toContain("Question 0");
    expect(result).toContain("Question 1");
    expect(result).toContain("Question 2");
  });

  test("respects limit parameter", async () => {
    const plugin = await pluginWithDecisions(5);
    const result = await plugin.executeTool("get_decision_history", { limit: 2 }) as string;
    // Should mention count
    expect(result).toContain("2 record");
  });

  test("returns most recent decisions first", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("record_decision", { question: "First Q", chosen_option: "A", rationale: "R" });
    await plugin.executeTool("record_decision", { question: "Second Q", chosen_option: "B", rationale: "R" });
    const result = await plugin.executeTool("get_decision_history", {}) as string;
    expect(result.indexOf("Second Q")).toBeLessThan(result.indexOf("First Q"));
  });

  test("query filter narrows results", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("record_decision", { question: "database choice", chosen_option: "postgres", rationale: "ACID" });
    await plugin.executeTool("record_decision", { question: "language choice", chosen_option: "typescript", rationale: "types" });
    const result = await plugin.executeTool("get_decision_history", { query: "database" }) as string;
    expect(result).toContain("database choice");
    expect(result).not.toContain("language choice");
  });

  test("query filter returns no-match message when nothing matches", async () => {
    const plugin = await pluginWithDecisions(2);
    const result = await plugin.executeTool("get_decision_history", { query: "zzznomatch" }) as string;
    expect(result).toContain("No decisions found matching");
  });

  test("includes options_considered in output", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("record_decision", {
      question: "Q",
      chosen_option: "A",
      rationale: "R",
      options_considered: ["A", "B", "C"],
    });
    const result = await plugin.executeTool("get_decision_history", {}) as string;
    expect(result).toContain("A, B, C");
  });
});
