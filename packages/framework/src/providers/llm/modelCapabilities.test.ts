import { test, expect, describe } from "bun:test";
import { getModelCapabilities } from "./modelCapabilities.ts";

describe("getModelCapabilities", () => {
  describe("gemma4 models", () => {
    const gemma4Names = [
      "gemma4:26b",
      "gemma4:12b",
      "gemma-4:27b",
      "gemma_4:27b",
      "GEMMA4:26B",
      "google/gemma4-27b",
      "hf.co/google/gemma-4-27b-it",
    ];

    for (const name of gemma4Names) {
      test(`"${name}" gets systemPromptPrefix <|think|>`, () => {
        const caps = getModelCapabilities(name);
        expect(caps.systemPromptPrefix).toBe("<|think|>");
      });
    }
  });

  describe("non-gemma4 models", () => {
    const otherModels = [
      "gemma3:4b",
      "gemma-3-4b",
      "llama3.2",
      "qwen/qwen3.5-35b-a3b",
      "deepseek-r1:14b",
      "mistral:7b",
      "",
    ];

    for (const name of otherModels) {
      test(`"${name}" has no systemPromptPrefix`, () => {
        const caps = getModelCapabilities(name);
        expect(caps.systemPromptPrefix).toBeUndefined();
      });
    }
  });

  test("returns an empty object for an unknown model", () => {
    const caps = getModelCapabilities("unknown-model-xyz");
    expect(caps).toEqual({});
  });
});
