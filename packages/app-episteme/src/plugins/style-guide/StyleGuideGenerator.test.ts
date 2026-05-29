import { test, expect, describe } from "bun:test";
import { parseTitleAndBody } from "./StyleGuideGenerator.ts";

describe("parseTitleAndBody", () => {
  test("splits a well-formed TITLE + body", () => {
    const raw = "TITLE: Concise Voice\n\n- Use short sentences.\n- Cut filler.";
    const { title, body } = parseTitleAndBody(raw);
    expect(title).toBe("Concise Voice");
    expect(body).toBe("- Use short sentences.\n- Cut filler.");
  });

  test("is case-insensitive on the TITLE label and tolerates leading blank lines", () => {
    const raw = "\n\ntitle:   British English\n\nUse -our spellings.";
    const { title, body } = parseTitleAndBody(raw);
    expect(title).toBe("British English");
    expect(body).toBe("Use -our spellings.");
  });

  test("strips a wrapping markdown fence", () => {
    const raw = "```markdown\nTITLE: Coder Voice\n\nFormat code as `inline`.\n```";
    const { title, body } = parseTitleAndBody(raw);
    expect(title).toBe("Coder Voice");
    expect(body).toBe("Format code as `inline`.");
  });

  test("falls back to a derived title when TITLE is absent", () => {
    const raw = "- Use active voice.\n- Prefer short sentences.";
    const { title, body } = parseTitleAndBody(raw, "punchy journalistic tone for blogs");
    expect(title).toBe("Punchy journalistic tone for");
    expect(body).toBe("- Use active voice.\n- Prefer short sentences.");
  });

  test("uses the description fallback when TITLE value is empty", () => {
    const raw = "TITLE:\n\nBe brief.";
    const { title, body } = parseTitleAndBody(raw, "terse");
    expect(title).toBe("Terse");
    expect(body).toBe("Be brief.");
  });

  test("strips a leading placeholder line the model echoed verbatim", () => {
    const raw = "TITLE: Approachability\n<blank line>\n\nWrite in a welcoming way.";
    const { title, body } = parseTitleAndBody(raw);
    expect(title).toBe("Approachability");
    expect(body).toBe("Write in a welcoming way.");
  });

  test("defaults to Untitled with neither title nor description", () => {
    const { title } = parseTitleAndBody("Body only.", "");
    expect(title).toBe("Untitled");
  });
});
