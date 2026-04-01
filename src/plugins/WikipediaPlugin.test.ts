import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { WikipediaPlugin } from "./WikipediaPlugin.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMobileSectionsResponse(overrides?: {
  leadText?: string;
  sections?: Array<{ id: number; toclevel?: number; line?: string; anchor?: string; text?: string }>;
}) {
  return {
    lead: {
      sections: [
        {
          id: 0,
          text: overrides?.leadText ?? "<p>Lead paragraph.</p>",
        },
      ],
    },
    remaining: {
      sections: overrides?.sections ?? [
        {
          id: 1,
          toclevel: 1,
          line: "History",
          anchor: "History",
          text: '<p>History content. <a href="./NBA" title="NBA">National Basketball Association</a> was founded.</p>',
        },
        {
          id: 2,
          toclevel: 2,
          line: "Early years",
          anchor: "Early_years",
          text: '<p>Early years. See also <a href="./NBA" title="NBA">NBA</a> and <a href="./Toronto" title="Toronto">Toronto</a>.</p>',
        },
      ],
    },
  };
}

function mockFetch(response: object, status = 200) {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Pure function tests — access via the plugin by calling executeTool, or
// test indirectly via getSection / getLinks results.
// We expose the helpers for direct testing by re-importing the module internals
// through executeTool round-trips.
// ---------------------------------------------------------------------------

describe("cleanSectionText (via wikipedia_get_section)", () => {
  let plugin: WikipediaPlugin;

  beforeEach(() => {
    plugin = new WikipediaPlugin();
  });

  test("strips HTML tags", async () => {
    const sections = makeMobileSectionsResponse({ leadText: "<p>Hello <b>world</b>.</p>" });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
    })) as { content: string };
    expect(result.content).toBe("Hello world.");
  });

  test("decodes HTML entities", async () => {
    const sections = makeMobileSectionsResponse({
      leadText: "<p>A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; F&nbsp;G</p>",
    });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
    })) as { content: string };
    expect(result.content).toBe('A & B <C> "D" \'E\' F G');
  });

  test("removes citation artifacts [1], [citation needed], [note 1]", async () => {
    const sections = makeMobileSectionsResponse({
      leadText: "<p>Fact[1] another[citation needed] thing[note 1].</p>",
    });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
    })) as { content: string };
    expect(result.content).toBe("Fact another thing.");
  });

  test("does not strip brackets longer than 30 characters", async () => {
    const longBracket = "[" + "x".repeat(31) + "]";
    const sections = makeMobileSectionsResponse({
      leadText: `<p>Keep ${longBracket} this.</p>`,
    });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
    })) as { content: string };
    expect(result.content).toContain(longBracket);
  });

  test("collapses excess newlines", async () => {
    const sections = makeMobileSectionsResponse({
      leadText: "<p>Line one</p>\n\n\n\n<p>Line two</p>",
    });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
    })) as { content: string };
    expect(result.content).toBe("Line one\n\nLine two");
  });
});

// ---------------------------------------------------------------------------
// extractLinks (via wikipedia_get_links)
// ---------------------------------------------------------------------------

describe("extractLinks (via wikipedia_get_links)", () => {
  let plugin: WikipediaPlugin;

  beforeEach(() => {
    plugin = new WikipediaPlugin();
  });

  test("returns correct { text, title } pairs", async () => {
    const sections = makeMobileSectionsResponse({
      leadText:
        '<p>The <a href="./Toronto_Raptors" title="Toronto Raptors">Raptors</a> play in <a href="./Toronto" title="Toronto">Toronto</a>.</p>',
    });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
      section_index: 0,
    })) as { links: WikiLink[] };
    expect(result.links).toEqual([
      { text: "Raptors", title: "Toronto Raptors" },
      { text: "Toronto", title: "Toronto" },
    ]);
  });

  test("deduplicates repeated links to the same title", async () => {
    const sections = makeMobileSectionsResponse({
      leadText:
        '<p><a href="./NBA" title="NBA">NBA</a> and again <a href="./NBA" title="NBA">the NBA</a>.</p>',
    });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
      section_index: 0,
    })) as { links: WikiLink[]; total_links: number };
    expect(result.links.length).toBe(1);
    expect(result.total_links).toBe(1);
    expect(result.links[0].title).toBe("NBA");
  });

  test("excludes anchors without a title attribute", async () => {
    const sections = makeMobileSectionsResponse({
      leadText: '<p><a href="https://example.com">External</a> and <a href="#section">Jump</a>.</p>',
    });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
      section_index: 0,
    })) as { links: WikiLink[] };
    expect(result.links).toEqual([]);
  });

  test("returns empty links array for section with no links", async () => {
    const sections = makeMobileSectionsResponse({ leadText: "<p>No links here.</p>" });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
      section_index: 0,
    })) as { links: WikiLink[]; total_links: number };
    expect(result.links).toEqual([]);
    expect(result.total_links).toBe(0);
  });

  test("full-article deduplicates across sections", async () => {
    // NBA appears in both section 1 and section 2; Toronto only in section 2
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
    })) as { links: WikiLink[]; total_links: number };
    const titles = result.links.map((l: WikiLink) => l.title);
    expect(titles.filter((t: string) => t === "NBA").length).toBe(1);
    expect(titles).toContain("Toronto");
  });
});

// ---------------------------------------------------------------------------
// wikipedia_list_sections
// ---------------------------------------------------------------------------

describe("wikipedia_list_sections", () => {
  let plugin: WikipediaPlugin;

  beforeEach(() => {
    plugin = new WikipediaPlugin();
  });

  test("returns lead at index 0 and body sections", async () => {
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_list_sections", {
      title: "Toronto Raptors",
    })) as { sections: Array<{ index: number; title: string; toclevel: number }> };
    expect(result.sections[0]).toMatchObject({ index: 0, title: "Introduction", toclevel: 1 });
    expect(result.sections[1]).toMatchObject({ index: 1, title: "History", toclevel: 1 });
    expect(result.sections[2]).toMatchObject({ index: 2, title: "Early years", toclevel: 2 });
  });

  test("returns correct section_count", async () => {
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_list_sections", {
      title: "Test",
    })) as { section_count: number };
    expect(result.section_count).toBe(3); // lead + 2 remaining
  });

  test("returns { error } on 404", async () => {
    globalThis.fetch = mockFetch({ title: "Not Found" }, 404) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_list_sections", {
      title: "Nonexistent Article",
    })) as { error: string };
    expect(result.error).toContain("not found");
  });

  test("throws on non-404 HTTP error", async () => {
    globalThis.fetch = mockFetch({}, 500) as unknown as typeof fetch;
    await expect(
      plugin.executeTool("wikipedia_list_sections", { title: "Test" }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// wikipedia_get_section
// ---------------------------------------------------------------------------

describe("wikipedia_get_section", () => {
  let plugin: WikipediaPlugin;

  beforeEach(() => {
    plugin = new WikipediaPlugin();
  });

  test("index 0 returns lead content cleaned", async () => {
    const sections = makeMobileSectionsResponse({ leadText: "<p>Lead <b>text</b>.</p>" });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
    })) as { section_title: string; content: string; section_index: number };
    expect(result.section_title).toBe("Introduction");
    expect(result.section_index).toBe(0);
    expect(result.content).toBe("Lead text.");
  });

  test("body section index returns correct content cleaned", async () => {
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 1,
    })) as { section_title: string; content: string };
    expect(result.section_title).toBe("History");
    expect(result.content).toContain("History content.");
    expect(result.content).toContain("National Basketball Association");
    expect(result.content).not.toContain("<");
  });

  test("truncates at max_chars and sets truncated: true", async () => {
    const longText = "x".repeat(200);
    const sections = makeMobileSectionsResponse({ leadText: `<p>${longText}</p>` });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
      max_chars: 50,
    })) as { content: string; truncated: boolean; total_chars: number };
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(50);
    expect(result.total_chars).toBe(200);
  });

  test("total_chars reflects pre-truncation length", async () => {
    const text = "a".repeat(100);
    const sections = makeMobileSectionsResponse({ leadText: `<p>${text}</p>` });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
      max_chars: 10,
    })) as { total_chars: number };
    expect(result.total_chars).toBe(100);
  });

  test("no truncation when content fits within max_chars", async () => {
    const sections = makeMobileSectionsResponse({ leadText: "<p>Short.</p>" });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
    })) as { truncated: boolean };
    expect(result.truncated).toBe(false);
  });

  test("unknown section index returns { error }", async () => {
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 99,
    })) as { error: string };
    expect(result.error).toContain("99");
  });

  test("returns { error } on 404", async () => {
    globalThis.fetch = mockFetch({}, 404) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_section", {
      title: "Nonexistent",
      section_index: 0,
    })) as { error: string };
    expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// wikipedia_get_links
// ---------------------------------------------------------------------------

describe("wikipedia_get_links", () => {
  let plugin: WikipediaPlugin;

  beforeEach(() => {
    plugin = new WikipediaPlugin();
  });

  test("section_index scopes links to that section only", async () => {
    // Section 1 has NBA. Section 2 has NBA + Toronto. Section-scoped call on 1 should only see NBA.
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
      section_index: 1,
    })) as { links: WikiLink[]; section_title: string };
    const titles = result.links.map((l: WikiLink) => l.title);
    expect(titles).toContain("NBA");
    expect(titles).not.toContain("Toronto");
    expect(result.section_title).toBe("History");
  });

  test("section_title is null for full-article calls", async () => {
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
    })) as { section_title: null };
    expect(result.section_title).toBeNull();
  });

  test("limit caps returned links and total_links reflects pre-limit count", async () => {
    const manyLinks = Array.from(
      { length: 10 },
      (_, i) =>
        `<a href="./${i}" title="Article ${i}">Article ${i}</a>`,
    ).join(" ");
    const sections = makeMobileSectionsResponse({ leadText: `<p>${manyLinks}</p>` });
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
      section_index: 0,
      limit: 3,
    })) as { links: WikiLink[]; total_links: number };
    expect(result.links.length).toBe(3);
    expect(result.total_links).toBe(10);
  });

  test("section_index pointing to nonexistent section returns { error }", async () => {
    const sections = makeMobileSectionsResponse();
    globalThis.fetch = mockFetch(sections) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Test",
      section_index: 99,
    })) as { error: string };
    expect(result.error).toContain("99");
  });

  test("returns { error } on 404", async () => {
    globalThis.fetch = mockFetch({}, 404) as unknown as typeof fetch;
    const result = (await plugin.executeTool("wikipedia_get_links", {
      title: "Nonexistent",
    })) as { error: string };
    expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Cache deduplication
// ---------------------------------------------------------------------------

describe("sectionCache", () => {
  test("two tool calls on the same title within TTL produce one fetch", async () => {
    const plugin = new WikipediaPlugin();
    const sections = makeMobileSectionsResponse();
    const fetchMock = mockFetch(sections);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await plugin.executeTool("wikipedia_list_sections", { title: "Test" });
    await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("call after TTL expiry produces a second fetch", async () => {
    const plugin = new WikipediaPlugin();
    const sections = makeMobileSectionsResponse();
    const fetchMock = mockFetch(sections);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Poison the cache with an already-expired entry by setting expiresAt in the past
    (plugin as any).sectionCache.set(encodeURIComponent("Test"), {
      data: sections,
      expiresAt: Date.now() - 1,
    });

    await plugin.executeTool("wikipedia_list_sections", { title: "Test" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Type alias used in test file
type WikiLink = { text: string; title: string };
