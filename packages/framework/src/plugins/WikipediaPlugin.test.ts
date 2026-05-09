import { describe, test, expect, beforeEach, mock } from "bun:test";
import { WikipediaPlugin } from "./WikipediaPlugin.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type WikiMockOptions = {
  tocSections?: TocSection[];
  sectionHtml?: string | ((index: number) => string);
  articleLinks?: { title: string }[];
  errorCode?: string;
};

type TocSection = {
  index: string;
  toclevel: number;
  level: string;
  line: string;
  anchor: string;
};

const DEFAULT_TOC: TocSection[] = [
  { index: "1", toclevel: 1, level: "2", line: "History", anchor: "History" },
  { index: "2", toclevel: 2, level: "3", line: "Early years", anchor: "Early_years" },
];

const DEFAULT_SECTION_HTML = (index: number) =>
  index === 0
    ? '<p>Lead paragraph. <a href="/wiki/NBA" title="NBA">National Basketball Association</a> was founded.</p>'
    : `<p>Section ${index} content. <a href="/wiki/Toronto" title="Toronto">Toronto</a>.</p>`;

// Builds a fetch mock that routes responses by action API params.
function makeWikiMock(opts: WikiMockOptions = {}) {
  const {
    tocSections = DEFAULT_TOC,
    sectionHtml = DEFAULT_SECTION_HTML,
    articleLinks = [{ title: "Toronto" }, { title: "NBA" }],
    errorCode,
  } = opts;

  return mock((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? input.toString();
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    const prop = params.get("prop");
    const action = params.get("action");
    const section = params.get("section");

    if (errorCode) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: errorCode, info: "Error." } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    let body: object;
    if (action === "parse" && prop === "sections") {
      body = { parse: { title: "Test", pageid: 1, sections: tocSections } };
    } else if (action === "parse" && prop === "text") {
      const idx = section !== null ? Number(section) : 0;
      const html = typeof sectionHtml === "function" ? sectionHtml(idx) : sectionHtml;
      body = { parse: { title: "Test", pageid: 1, text: { "*": html } } };
    } else if (action === "query" && prop === "links") {
      body = {
        query: { pages: { "1": { pageid: 1, ns: 0, title: "Test", links: articleLinks } } },
      };
    } else {
      body = {};
    }

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mockHttpError(status: number) {
  return mock(() =>
    Promise.resolve(new Response("", { status, headers: { "Content-Type": "application/json" } })),
  );
}

// ---------------------------------------------------------------------------
// cleanSectionText (via wikipedia_get_section index 0 — no TOC fetch needed)
// ---------------------------------------------------------------------------

describe("cleanSectionText (via wikipedia_get_section §0)", () => {
  let plugin: WikipediaPlugin;
  beforeEach(() => { plugin = new WikipediaPlugin(); });

  test("strips HTML tags", async () => {
    globalThis.fetch = makeWikiMock({ sectionHtml: "<p>Hello <b>world</b>.</p>" }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "T", section_index: 0 })) as any;
    expect(r.content).toBe("Hello world.");
  });

  test("decodes HTML entities", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml: "<p>A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; F&nbsp;G</p>",
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "T", section_index: 0 })) as any;
    expect(r.content).toBe('A & B <C> "D" \'E\' F G');
  });

  test("removes citation artifacts", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml: "<p>Fact[1] another[citation needed] thing[note 1].</p>",
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "T", section_index: 0 })) as any;
    expect(r.content).toBe("Fact another thing.");
  });

  test("does not strip brackets longer than 30 characters", async () => {
    const longBracket = "[" + "x".repeat(31) + "]";
    globalThis.fetch = makeWikiMock({ sectionHtml: `<p>Keep ${longBracket} this.</p>` }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "T", section_index: 0 })) as any;
    expect(r.content).toContain(longBracket);
  });

  test("collapses excess newlines", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml: "<p>Line one</p>\n\n\n\n<p>Line two</p>",
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "T", section_index: 0 })) as any;
    expect(r.content).toBe("Line one\n\nLine two");
  });
});

// ---------------------------------------------------------------------------
// extractLinks (via wikipedia_get_links §0)
// ---------------------------------------------------------------------------

describe("extractLinks (via wikipedia_get_links §0)", () => {
  let plugin: WikipediaPlugin;
  beforeEach(() => { plugin = new WikipediaPlugin(); });

  test("returns correct { text, title } pairs", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml:
        '<p>The <a href="/wiki/Toronto_Raptors" title="Toronto Raptors">Raptors</a> play in <a href="/wiki/Toronto" title="Toronto">Toronto</a>.</p>',
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "T", section_index: 0 })) as any;
    expect(r.links).toEqual([
      { text: "Raptors", title: "Toronto Raptors" },
      { text: "Toronto", title: "Toronto" },
    ]);
  });

  test("deduplicates repeated links to the same title", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml:
        '<p><a href="/wiki/NBA" title="NBA">NBA</a> and again <a href="/wiki/NBA" title="NBA">the NBA</a>.</p>',
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "T", section_index: 0 })) as any;
    expect(r.links.length).toBe(1);
    expect(r.total_links).toBe(1);
    expect(r.links[0].title).toBe("NBA");
  });

  test("excludes anchors without a title attribute", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml: '<p><a href="https://example.com">External</a> and <a href="#section">Jump</a>.</p>',
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "T", section_index: 0 })) as any;
    expect(r.links).toEqual([]);
  });

  test("excludes namespace links (title contains ':')", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml:
        '<p><a href="/wiki/File:Photo.jpg" title="File:Photo.jpg">photo</a> ' +
        '<a href="/wiki/Toronto" title="Toronto">Toronto</a> ' +
        '<a href="/w/index.php?action=edit" title="Edit section: History">edit</a></p>',
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "T", section_index: 0 })) as any;
    expect(r.links.map((l: any) => l.title)).toEqual(["Toronto"]);
  });

  test("returns empty links array for section with no links", async () => {
    globalThis.fetch = makeWikiMock({ sectionHtml: "<p>No links here.</p>" }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "T", section_index: 0 })) as any;
    expect(r.links).toEqual([]);
    expect(r.total_links).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// wikipedia_list_sections
// ---------------------------------------------------------------------------

describe("wikipedia_list_sections", () => {
  let plugin: WikipediaPlugin;
  beforeEach(() => { plugin = new WikipediaPlugin(); });

  test("returns lead at index 0 and body sections from TOC", async () => {
    globalThis.fetch = makeWikiMock() as any;
    const r = (await plugin.executeTool("wikipedia_list_sections", { title: "Test" })) as any;
    expect(r.sections[0]).toMatchObject({ index: 0, title: "Introduction", toclevel: 1 });
    expect(r.sections[1]).toMatchObject({ index: 1, title: "History", toclevel: 1 });
    expect(r.sections[2]).toMatchObject({ index: 2, title: "Early years", toclevel: 2 });
  });

  test("returns correct section_count", async () => {
    globalThis.fetch = makeWikiMock() as any;
    const r = (await plugin.executeTool("wikipedia_list_sections", { title: "Test" })) as any;
    expect(r.section_count).toBe(3); // lead + 2 body sections
  });

  test("returns { error } when article not found", async () => {
    globalThis.fetch = makeWikiMock({ errorCode: "missingtitle" }) as any;
    const r = (await plugin.executeTool("wikipedia_list_sections", { title: "Nonexistent" })) as any;
    expect(r.error).toContain("not found");
  });

  test("throws on HTTP error", async () => {
    globalThis.fetch = mockHttpError(500) as any;
    await expect(
      plugin.executeTool("wikipedia_list_sections", { title: "Test" }),
    ).rejects.toThrow();
  });

  test("returns { sections: [intro only] } for article with no sections", async () => {
    globalThis.fetch = makeWikiMock({ tocSections: [] }) as any;
    const r = (await plugin.executeTool("wikipedia_list_sections", { title: "Stub" })) as any;
    expect(r.section_count).toBe(1);
    expect(r.sections[0].title).toBe("Introduction");
  });
});

// ---------------------------------------------------------------------------
// wikipedia_get_section
// ---------------------------------------------------------------------------

describe("wikipedia_get_section", () => {
  let plugin: WikipediaPlugin;
  beforeEach(() => { plugin = new WikipediaPlugin(); });

  test("index 0 returns cleaned lead content without a TOC fetch", async () => {
    const fetchMock = makeWikiMock({ sectionHtml: "<p>Lead <b>text</b>.</p>" });
    globalThis.fetch = fetchMock as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 0 })) as any;
    expect(r.section_title).toBe("Introduction");
    expect(r.section_index).toBe(0);
    expect(r.content).toBe("Lead text.");
    // Only one fetch: fetchSectionHtml (no TOC needed for index 0)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("body section returns correct title and cleaned content", async () => {
    globalThis.fetch = makeWikiMock({ sectionHtml: "<p>History content.</p>" }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 1 })) as any;
    expect(r.section_title).toBe("History");
    expect(r.content).toContain("History content.");
    expect(r.content).not.toContain("<");
  });

  test("truncates at max_chars and sets truncated: true", async () => {
    globalThis.fetch = makeWikiMock({ sectionHtml: `<p>${"x".repeat(200)}</p>` }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
      max_chars: 50,
    })) as any;
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBe(50);
    expect(r.total_chars).toBe(200);
  });

  test("total_chars reflects pre-truncation length", async () => {
    globalThis.fetch = makeWikiMock({ sectionHtml: `<p>${"a".repeat(100)}</p>` }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", {
      title: "Test",
      section_index: 0,
      max_chars: 10,
    })) as any;
    expect(r.total_chars).toBe(100);
  });

  test("no truncation when content fits within max_chars", async () => {
    globalThis.fetch = makeWikiMock({ sectionHtml: "<p>Short.</p>" }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 0 })) as any;
    expect(r.truncated).toBe(false);
  });

  test("unknown section index returns { error }", async () => {
    globalThis.fetch = makeWikiMock() as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 99 })) as any;
    expect(r.error).toContain("99");
  });

  test("returns { error } when article not found", async () => {
    globalThis.fetch = makeWikiMock({ errorCode: "missingtitle" }) as any;
    const r = (await plugin.executeTool("wikipedia_get_section", { title: "Nonexistent", section_index: 0 })) as any;
    expect(r.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// wikipedia_get_links
// ---------------------------------------------------------------------------

describe("wikipedia_get_links", () => {
  let plugin: WikipediaPlugin;
  beforeEach(() => { plugin = new WikipediaPlugin(); });

  test("section-scoped call returns links from that section only", async () => {
    globalThis.fetch = makeWikiMock({
      sectionHtml: (i) =>
        i === 1
          ? '<p><a href="/wiki/NBA" title="NBA">NBA</a>.</p>'
          : '<p><a href="/wiki/Toronto" title="Toronto">Toronto</a>.</p>',
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "Test", section_index: 1 })) as any;
    expect(r.links.map((l: any) => l.title)).toContain("NBA");
    expect(r.links.map((l: any) => l.title)).not.toContain("Toronto");
    expect(r.section_title).toBe("History");
  });

  test("section_title is null for full-article calls", async () => {
    globalThis.fetch = makeWikiMock() as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "Test" })) as any;
    expect(r.section_title).toBeNull();
  });

  test("full-article call uses prop=links and returns title as both text and title", async () => {
    globalThis.fetch = makeWikiMock({
      articleLinks: [{ title: "NBA" }, { title: "Toronto" }],
    }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "Test" })) as any;
    expect(r.links).toEqual([
      { text: "NBA", title: "NBA" },
      { text: "Toronto", title: "Toronto" },
    ]);
  });

  test("limit caps returned links; total_links reflects pre-limit count", async () => {
    const manyLinks = Array.from({ length: 10 }, (_, i) => ({ title: `Article ${i}` }));
    globalThis.fetch = makeWikiMock({ articleLinks: manyLinks }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "Test", limit: 3 })) as any;
    expect(r.links.length).toBe(3);
    expect(r.total_links).toBe(10);
  });

  test("unknown section index returns { error }", async () => {
    globalThis.fetch = makeWikiMock() as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "Test", section_index: 99 })) as any;
    expect(r.error).toContain("99");
  });

  test("returns { error } when article not found", async () => {
    globalThis.fetch = makeWikiMock({ errorCode: "missingtitle" }) as any;
    const r = (await plugin.executeTool("wikipedia_get_links", { title: "Nonexistent" })) as any;
    expect(r.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Cache deduplication
// ---------------------------------------------------------------------------

describe("cache deduplication", () => {
  test("two list_sections calls on the same title produce one TOC fetch", async () => {
    const plugin = new WikipediaPlugin();
    const fetchMock = makeWikiMock();
    globalThis.fetch = fetchMock as any;

    await plugin.executeTool("wikipedia_list_sections", { title: "Test" });
    await plugin.executeTool("wikipedia_list_sections", { title: "Test" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("list_sections then get_section (same article) reuses TOC cache", async () => {
    const plugin = new WikipediaPlugin();
    const fetchMock = makeWikiMock();
    globalThis.fetch = fetchMock as any;

    await plugin.executeTool("wikipedia_list_sections", { title: "Test" });
    // get_section §1: needs TOC (cache hit) + section HTML (new fetch) = 1 new fetch
    await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 TOC + 1 section HTML
  });

  test("two get_section calls for the same section produce one section HTML fetch", async () => {
    const plugin = new WikipediaPlugin();
    const fetchMock = makeWikiMock();
    globalThis.fetch = fetchMock as any;

    await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 0 });
    await plugin.executeTool("wikipedia_get_section", { title: "Test", section_index: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("call after TOC cache expiry produces a new fetch", async () => {
    const plugin = new WikipediaPlugin();
    const fetchMock = makeWikiMock();
    globalThis.fetch = fetchMock as any;

    // Poison the TOC cache with an already-expired entry
    (plugin as any).tocCache.set("Test", {
      data: DEFAULT_TOC.map((s) => ({ index: Number(s.index), toclevel: s.toclevel, line: s.line, anchor: s.anchor })),
      expiresAt: Date.now() - 1,
    });

    await plugin.executeTool("wikipedia_list_sections", { title: "Test" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
