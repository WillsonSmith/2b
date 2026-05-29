import { test, expect, describe } from "bun:test";
import { resolveMarkdownLinkInSsg, extractEdgesForFile } from "./render.ts";

describe("resolveMarkdownLinkInSsg with spaces", () => {
  const files = ["My Note.md", "notes/Other Page.md"];

  test("resolves a decoded spaced href", () => {
    expect(resolveMarkdownLinkInSsg("My Note.md", "index.md", files)).toBe("My Note.md");
  });
  test("resolves a percent-encoded spaced href", () => {
    expect(resolveMarkdownLinkInSsg("My%20Note.md", "index.md", files)).toBe("My Note.md");
  });
});

describe("extractEdgesForFile with angle-bracket links", () => {
  const files = ["index.md", "My Note.md"];

  test("captures an edge from a wrapped spaced destination", () => {
    const edges = extractEdgesForFile("[X](<My Note.md>)", files, "index.html");
    expect(edges).toEqual(["My Note.html"]);
  });
  test("captures an edge from a bare destination", () => {
    const edges = extractEdgesForFile("[I](index.md)", files, "My Note.html");
    expect(edges).toEqual(["index.html"]);
  });
});
