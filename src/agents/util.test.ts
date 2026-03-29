import { test, expect, describe } from "bun:test";
import { removeThinkTags } from "./util";

describe("removeThinkTags - strict mode (default)", () => {
  test("removes a complete <think>...</think> block", () => {
    expect(removeThinkTags("<think>some reasoning</think>result")).toBe("result");
  });

  test("leaves content untouched when only opening tag is present", () => {
    expect(removeThinkTags("<think>incomplete")).toBe("<think>incomplete");
  });

  test("leaves content untouched when only closing tag is present", () => {
    expect(removeThinkTags("incomplete</think>result")).toBe("incomplete</think>result");
  });

  test("leaves content untouched with no tags", () => {
    expect(removeThinkTags("just a normal string")).toBe("just a normal string");
  });

  test("removes multiple complete blocks", () => {
    expect(removeThinkTags("<think>a</think>text<think>b</think>end")).toBe("textend");
  });

  test("removes block with multiline content", () => {
    expect(removeThinkTags("<think>\nline1\nline2\n</think>result")).toBe("result");
  });

  test("trims trailing/leading whitespace after removal", () => {
    expect(removeThinkTags("  <think>x</think>  ")).toBe("");
  });

  test("handles empty string input", () => {
    expect(removeThinkTags("")).toBe("");
  });

  test("handles result that is empty after removal", () => {
    expect(removeThinkTags("<think>everything</think>")).toBe("");
  });

  test("does not remove nested-looking tags (treats as flat)", () => {
    const result = removeThinkTags("<think>outer <think>inner</think></think>extra");
    // The first </think> closes the block; "</think>extra" remains
    expect(result).toBe("</think>extra");
  });

  test("does not remove block when tags are reversed", () => {
    expect(removeThinkTags("</think>content<think>")).toBe("</think>content<think>");
  });
});

describe("removeThinkTags - flexible mode", () => {
  test("strips content from string start up to first </think>", () => {
    expect(removeThinkTags("streamed reasoning content</think>result", true)).toBe("result");
  });

  test("also removes complete <think>...</think> pairs in flexible mode", () => {
    expect(removeThinkTags("<think>reasoning</think>result", true)).toBe("result");
  });

  test("strips leading content and a complete pair", () => {
    expect(removeThinkTags("prefix</think>middle<think>block</think>end", true)).toBe("middleend");
  });

  test("handles empty string in flexible mode", () => {
    expect(removeThinkTags("", true)).toBe("");
  });

  test("result is empty when all content is think block in flexible mode", () => {
    expect(removeThinkTags("reasoning</think>", true)).toBe("");
  });

  test("trims whitespace after removal in flexible mode", () => {
    expect(removeThinkTags("  think content</think>  answer  ", true)).toBe("answer");
  });

  test("no </think> in flexible mode leaves content untouched", () => {
    expect(removeThinkTags("no closing tag here", true)).toBe("no closing tag here");
  });
});
