import { test, expect, describe } from "bun:test";
import { fallbackTitle, finalizeSection } from "./StyleGuideGenerator.ts";

describe("fallbackTitle", () => {
  test("title-cases the first few words of the description", () => {
    expect(fallbackTitle("punchy journalistic tone for blogs")).toBe("Punchy journalistic tone for");
  });

  test("returns Untitled for an empty description", () => {
    expect(fallbackTitle("")).toBe("Untitled");
    expect(fallbackTitle("   ")).toBe("Untitled");
  });
});

describe("finalizeSection", () => {
  test("trims the body and keeps a present title", () => {
    const result = finalizeSection({ title: "Concise Voice", body: "\n- Use short sentences.\n" });
    expect(result.title).toBe("Concise Voice");
    expect(result.body).toBe("- Use short sentences.");
  });

  test("substitutes a description-derived title when the model returns a blank one", () => {
    const result = finalizeSection({ title: "   ", body: "Be brief." }, "terse");
    expect(result.title).toBe("Terse");
    expect(result.body).toBe("Be brief.");
  });

  test("falls back to Untitled when both title and description are empty", () => {
    const result = finalizeSection({ title: "", body: "Body only." }, "");
    expect(result.title).toBe("Untitled");
  });
});
