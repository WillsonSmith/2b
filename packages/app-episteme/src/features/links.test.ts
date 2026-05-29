import { test, expect, describe } from "bun:test";
import {
  decodeLinkHref,
  formatLinkDestination,
  resolveLocalHref,
  computeRelativeHref,
  rewriteLinksForRename,
} from "./links.ts";

describe("decodeLinkHref", () => {
  test("decodes percent-encoded spaces", () => {
    expect(decodeLinkHref("My%20Note.md")).toBe("My Note.md");
  });
  test("is a no-op on already-decoded paths", () => {
    expect(decodeLinkHref("My Note.md")).toBe("My Note.md");
  });
  test("falls back to raw on malformed sequences", () => {
    expect(decodeLinkHref("100%off.md")).toBe("100%off.md");
  });
});

describe("formatLinkDestination", () => {
  test("wraps spaced destinations in angle brackets", () => {
    expect(formatLinkDestination("My Note.md")).toBe("<My Note.md>");
  });
  test("wraps when the input arrives percent-encoded", () => {
    expect(formatLinkDestination("My%20Note.md")).toBe("<My Note.md>");
  });
  test("leaves space-free destinations bare", () => {
    expect(formatLinkDestination("notes/plain.md")).toBe("notes/plain.md");
  });
  test("escapes parentheses in bare destinations", () => {
    expect(formatLinkDestination("a(b).md")).toBe("a\\(b\\).md");
  });
});

describe("resolveLocalHref with spaces", () => {
  const files = ["My Note.md", "notes/Other Page.md", "plain.md"];

  test("resolves a decoded spaced href", () => {
    expect(resolveLocalHref("My Note.md", "", files)).toBe("My Note.md");
  });
  test("resolves a percent-encoded spaced href (post-reload form)", () => {
    expect(resolveLocalHref("My%20Note.md", "", files)).toBe("My Note.md");
  });
  test("resolves relative spaced href from a nested current file", () => {
    expect(resolveLocalHref("Other%20Page.md", "notes/index.md", files)).toBe(
      "notes/Other Page.md",
    );
  });
  test("returns null for a missing spaced file", () => {
    expect(resolveLocalHref("No Such.md", "", files)).toBeNull();
  });
});

describe("computeRelativeHref", () => {
  test("keeps spaces in the raw relative path", () => {
    expect(computeRelativeHref("notes/index.md", "notes/My Note.md")).toBe("My Note.md");
  });
});

describe("rewriteLinksForRename with angle-bracket links", () => {
  test("rewrites a wrapped destination on rename", () => {
    const content = "See [My Note](<My Note.md>) here.";
    const out = rewriteLinksForRename(content, "index.md", "My Note.md", "My Renamed Note.md");
    expect(out).toBe("See [My Note](<My Renamed Note.md>) here.");
  });
  test("rewrites a bare destination and wraps the new spaced name", () => {
    const content = "See [Plain](plain.md) here.";
    const out = rewriteLinksForRename(content, "index.md", "plain.md", "renamed plain.md");
    expect(out).toBe("See [Plain](<renamed plain.md>) here.");
  });
  test("preserves a fragment inside the angle brackets", () => {
    const content = "[X](<My Note.md#top>)";
    const out = rewriteLinksForRename(content, "index.md", "My Note.md", "New Note.md");
    expect(out).toBe("[X](<New Note.md#top>)");
  });
  test("leaves unrelated links untouched", () => {
    const content = "[Ext](https://example.com) and [Plain](plain.md)";
    const out = rewriteLinksForRename(content, "index.md", "My Note.md", "New Note.md");
    expect(out).toBe(content);
  });
});
