import { parseFrontmatter, parseYamlFields } from "../features/frontmatter";
import { WIKILINK_RE, resolveWikilinkTarget } from "../features/wikilinks";
import { marked } from "marked";
import * as path from "path";
import { mkdir, writeFile } from "fs/promises";

// Render mermaid fenced blocks as <div class="mermaid"> instead of <pre><code>
marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang === "mermaid") return `<div class="mermaid">${text}</div>\n`;
      return false;
    },
  },
});

interface RawFile {
  relPath: string;
  body: string;
  title: string;
  tags: string[];
  date: string | null;
  summary: string | null;
}

interface FileInfo {
  relPath: string;
  htmlRelPath: string;
  title: string;
  tags: string[];
  date: string | null;
  summary: string | null;
  html: string;
  depth: number;
}

function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pathToRoot(depth: number): string {
  return depth === 0 ? "" : "../".repeat(depth);
}

function titleFromPath(relPath: string): string {
  const stem = path.basename(relPath, ".md");
  return stem.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleFromMarkdown(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function relativeHref(fromRelPath: string, toRelPath: string): string {
  const fromDir = path.dirname(fromRelPath);
  return path.relative(fromDir === "." ? "" : fromDir, toRelPath).replace(/\\/g, "/");
}

function resolveWikilinksInBody(body: string, allRelPaths: string[], currentRelPath: string): string {
  return body.replace(WIKILINK_RE, (_, target: string, alias: string | undefined) => {
    const display = alias?.trim() ?? target.trim();
    const resolved = resolveWikilinkTarget(target, allRelPaths);
    if (!resolved) {
      return `<span class="wikilink-broken" title="Broken link: ${target}">${display}</span>`;
    }
    const targetHtmlPath = resolved.replace(/\.md$/, ".html");
    const href = relativeHref(currentRelPath, targetHtmlPath);
    return `[${display}](${href})`;
  });
}

// Mermaid CDN + light/dark theme detection + dependency-free pan/zoom
const MERMAID_SCRIPT = `<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({
  startOnLoad: false,
  theme: dark ? 'base' : 'default',
  themeVariables: dark ? {
    background: '#181818', mainBkg: '#2e3a50', primaryColor: '#2e3a50',
    primaryTextColor: '#d4d4d4', primaryBorderColor: '#3d5a90',
    lineColor: '#888888', secondaryColor: '#202020', tertiaryColor: '#2a2a2a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  } : {},
});
await mermaid.run();
document.querySelectorAll('.mermaid').forEach(el => {
  const svg = el.querySelector('svg');
  if (!svg) return;
  let s = 1, tx = 0, ty = 0, pan = false, ox = 0, oy = 0;
  const apply = () => {
    svg.style.transformOrigin = '0 0';
    svg.style.transform = \`translate(\${tx}px,\${ty}px) scale(\${s})\`;
  };
  el.title = 'Scroll to zoom · Drag to pan · Double-click to reset';
  el.addEventListener('wheel', e => {
    e.preventDefault();
    s = Math.max(0.2, Math.min(s * (e.deltaY < 0 ? 1.1 : 0.9), 8));
    apply();
  }, { passive: false });
  el.addEventListener('mousedown', e => {
    pan = true; ox = e.clientX - tx; oy = e.clientY - ty;
    el.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!pan) return;
    tx = e.clientX - ox; ty = e.clientY - oy;
    apply();
  });
  window.addEventListener('mouseup', () => { pan = false; el.style.cursor = 'grab'; });
  el.addEventListener('dblclick', () => { s = 1; tx = 0; ty = 0; svg.style.transform = ''; });
});
</script>`;

// Design tokens match packages/app-episteme/src/styles/base.css (dark) with
// a light-mode override. Typography rules ported from markdown.css.
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#181818;--bg-raised:#202020;--bg-highlight:#2a2a2a;--bg-active:#2e3a50;
  --border:#333333;--border-light:#3d3d3d;
  --text:#d4d4d4;--text-muted:#888888;--text-dim:#555555;
  --accent:#6699dd;--accent-soft:#3d5a90;
  --md-scale-xs:0.75rem;--md-scale-sm:0.857rem;--md-scale-base:1rem;
  --md-scale-h3:1.125rem;--md-scale-h2:1.286rem;--md-scale-h1:1.5rem;
  --md-leading-heading:1.25;--md-leading-body:1.72;--md-leading-code:1.6;
  --md-sp1:0.25rem;--md-sp2:0.5rem;--md-sp3:0.875rem;--md-sp4:1.25rem;--md-sp5:2rem;
  --md-indent:1.5em;
  --md-font-mono:"JetBrains Mono","Fira Code",ui-monospace,monospace;
  --md-code-size:0.857em;--md-radius-sm:3px;--md-radius-md:5px;
  --max-w:720px;
}
@media(prefers-color-scheme:light){
  :root{
    --bg:#ffffff;--bg-raised:#f3f3f3;--bg-highlight:#ebebeb;--bg-active:#dce8ff;
    --border:#e0e0e0;--border-light:#eeeeee;
    --text:#1c1c1c;--text-muted:#666666;--text-dim:#aaaaaa;
    --accent:#2d5fcc;--accent-soft:#d0e4ff;
  }
}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  font-size:14px;background:var(--bg);color:var(--text);
  line-height:var(--md-leading-body);padding:2rem 1.5rem;
}

/* ── Nav ─────────────────────────────────────────────────────────────── */
nav{max-width:var(--max-w);margin:0 auto 2rem}
nav a{color:var(--accent);text-decoration:none;font-size:var(--md-scale-sm)}
nav a:hover{text-decoration:underline}

/* ── Page content ────────────────────────────────────────────────────── */
article{max-width:var(--max-w);margin:0 auto}
header{margin-bottom:var(--md-sp4);padding-bottom:var(--md-sp3);border-bottom:1px solid var(--border)}

/* ── Headings — ported from markdown.css ────────────────────────────── */
article h1,article h2,article h3,article h4,article h5,article h6{
  color:var(--text);margin-top:var(--md-sp4);margin-bottom:var(--md-sp2)
}
article :is(h1,h2,h3,h4,h5,h6):first-child{margin-top:0}
article h1{font-size:var(--md-scale-h1);font-weight:700;line-height:1.15;letter-spacing:-0.015em}
article h2{font-size:var(--md-scale-h2);font-weight:700;line-height:1.2;letter-spacing:-0.01em}
article h3{font-size:var(--md-scale-h3);font-weight:600;line-height:var(--md-leading-heading)}
article h4,article h5,article h6{font-size:var(--md-scale-base);font-weight:600;line-height:1.3}
article h2+h3{margin-top:var(--md-sp2)}

/* ── Prose ───────────────────────────────────────────────────────────── */
article p{margin-top:0;margin-bottom:var(--md-sp3)}
article p:last-child{margin-bottom:0}
article a{color:var(--accent);text-decoration:none}
article a:hover{text-decoration:underline}
article strong{font-weight:600;color:var(--text)}
article em{font-style:italic}

/* ── Lists ───────────────────────────────────────────────────────────── */
article ul,article ol{padding-left:var(--md-indent);margin:0 0 var(--md-sp3)}
article ul{list-style-type:disc}
article ul ul{list-style-type:square}
article ol{list-style-type:decimal}
article li{margin-bottom:0.35rem;line-height:var(--md-leading-body)}
article li:last-child{margin-bottom:0}
article li>ul>li,article li>ol>li{margin-bottom:var(--md-sp1)}
article li>ul,article li>ol{margin-top:var(--md-sp1);margin-bottom:0}

/* ── Code ────────────────────────────────────────────────────────────── */
article code{
  font-family:var(--md-font-mono);font-size:var(--md-code-size);
  background:var(--bg-highlight);padding:0.1em 0.35em;
  border-radius:var(--md-radius-sm);line-height:1
}
article pre{
  background:var(--bg-highlight);border:1px solid var(--border);
  border-radius:var(--md-radius-md);padding:var(--md-sp3);
  overflow-x:auto;margin-bottom:var(--md-sp3);line-height:var(--md-leading-code)
}
article pre code{background:none;padding:0;border-radius:0}

/* ── Blockquote ──────────────────────────────────────────────────────── */
article blockquote{
  border-left:2px solid var(--accent-soft);padding-left:var(--md-sp3);
  color:var(--text-muted);margin:0 0 var(--md-sp3);font-style:italic
}
article blockquote>*:last-child{margin-bottom:0}

/* ── HR ──────────────────────────────────────────────────────────────── */
article hr{border:none;border-top:1px solid var(--border);margin:var(--md-sp5) 0}

/* ── Tables ──────────────────────────────────────────────────────────── */
article table{border-collapse:collapse;width:100%;font-size:var(--md-scale-sm);
  line-height:1.5;margin-bottom:var(--md-sp3)}
article th,article td{border:1px solid var(--border);padding:var(--md-sp2) var(--md-sp3);
  text-align:left;vertical-align:top}
article th{background:var(--bg-highlight);font-weight:600;color:var(--text);white-space:nowrap}

/* ── Images ──────────────────────────────────────────────────────────── */
article img{max-width:100%;height:auto;border-radius:var(--md-radius-md)}

/* ── Wikilinks ───────────────────────────────────────────────────────── */
.wikilink-broken{color:var(--text-muted);border-bottom:1px dashed currentColor;cursor:help}

/* ── Mermaid diagrams ────────────────────────────────────────────────── */
.mermaid{
  overflow:hidden;position:relative;cursor:grab;user-select:none;
  background:var(--bg-raised);border:1px solid var(--border);
  border-radius:var(--md-radius-md);padding:var(--md-sp3);
  margin-bottom:var(--md-sp3);min-height:60px
}
.mermaid svg{display:block;max-width:100%}

/* ── Page header meta ────────────────────────────────────────────────── */
time{display:block;color:var(--text-muted);font-size:var(--md-scale-sm);margin-bottom:var(--md-sp2)}
.summary{color:var(--text-muted);font-style:italic;margin-bottom:var(--md-sp2)}
.tags{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:var(--md-sp2)}
.tags li a{
  display:inline-block;background:var(--bg-raised);color:var(--text-muted);
  border-radius:10px;padding:0.15rem 0.6rem;font-size:var(--md-scale-xs);text-decoration:none
}
.tags li a:hover{background:var(--accent);color:var(--bg)}

/* ── File listing (index / tag pages) ───────────────────────────────── */
.file-list{list-style:none;padding:0}
.file-list li{padding:var(--md-sp2) 0;border-bottom:1px solid var(--border)}
.file-list li:last-child{border-bottom:none}
.file-list a{text-decoration:none;color:var(--accent);font-weight:500}
.file-list a:hover{text-decoration:underline}
.file-meta{font-size:var(--md-scale-xs);color:var(--text-muted);margin-top:0.15rem}
.section-header{
  font-size:var(--md-scale-xs);font-weight:600;text-transform:uppercase;
  letter-spacing:0.08em;color:var(--text-dim);margin:var(--md-sp4) 0 var(--md-sp2)
}
.tag-cloud{display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:var(--md-sp4)}
.tag-cloud a{
  display:inline-flex;align-items:center;gap:0.3rem;background:var(--bg-raised);
  color:var(--text-muted);border-radius:10px;padding:0.25rem 0.75rem;
  font-size:var(--md-scale-sm);text-decoration:none
}
.tag-cloud a:hover{background:var(--accent);color:var(--bg)}
.tag-count{opacity:0.65;font-size:0.8em}
`.trim();

function pageShell(opts: {
  title: string;
  root: string;
  navExtra?: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
${MERMAID_SCRIPT}
<style>${CSS}</style>
</head>
<body>
<nav><a href="${opts.root}index.html">← Home</a>${opts.navExtra ? ` · ${opts.navExtra}` : ""}</nav>
<article>
${opts.body}
</article>
</body>
</html>`;
}

function contentPage(file: FileInfo, root: string): string {
  const tagsHtml =
    file.tags.length > 0
      ? `<ul class="tags">${file.tags
          .map((t) => `<li><a href="${root}tags/${slugify(t)}.html">${t}</a></li>`)
          .join("")}</ul>`
      : "";
  const dateHtml = file.date ? `<time>${file.date}</time>` : "";
  const summaryHtml = file.summary ? `<p class="summary">${file.summary}</p>` : "";

  const header = `<header>
<h1>${file.title}</h1>
${dateHtml}
${tagsHtml}
${summaryHtml}
</header>`;

  return pageShell({
    title: file.title,
    root,
    navExtra: file.tags
      .map((t) => `<a href="${root}tags/${slugify(t)}.html">${t}</a>`)
      .join(", ") || undefined,
    body: `${header}\n${file.html}`,
  });
}

function autoIndexPage(files: FileInfo[]): string {
  const byDir = new Map<string, FileInfo[]>();
  for (const f of files) {
    const dir = path.dirname(f.relPath) === "." ? "" : path.dirname(f.relPath);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }

  const allTags = new Map<string, number>();
  for (const f of files) {
    for (const t of f.tags) allTags.set(t, (allTags.get(t) ?? 0) + 1);
  }

  let sectionsHtml = "";
  const sortedDirs = [...byDir.keys()].sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });
  for (const dir of sortedDirs) {
    const sectionFiles = byDir.get(dir)!.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return a.title.localeCompare(b.title);
    });
    if (dir) {
      sectionsHtml += `<p class="section-header">${dir.replace(/\//g, " / ")}</p>`;
    }
    sectionsHtml += `<ul class="file-list">`;
    for (const f of sectionFiles) {
      const meta = [f.date, f.summary].filter(Boolean).join(" — ");
      sectionsHtml += `<li>
  <a href="${f.htmlRelPath}">${f.title}</a>
  ${meta ? `<div class="file-meta">${meta}</div>` : ""}
</li>`;
    }
    sectionsHtml += `</ul>`;
  }

  let tagCloudHtml = "";
  if (allTags.size > 0) {
    const sortedTags = [...allTags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    tagCloudHtml = `<h2>Tags</h2><div class="tag-cloud">${sortedTags
      .map(([t, n]) => `<a href="tags/${slugify(t)}.html">${t} <span class="tag-count">${n}</span></a>`)
      .join("")}</div>`;
  }

  return pageShell({
    title: "Index",
    root: "",
    body: `<header><h1>Index</h1></header>\n${tagCloudHtml}\n${sectionsHtml}`,
  });
}

function tagIndexPage(tagCounts: Map<string, number>): string {
  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cloud = `<div class="tag-cloud">${sorted
    .map(([t, n]) => `<a href="${slugify(t)}.html">${t} <span class="tag-count">${n}</span></a>`)
    .join("")}</div>`;
  return pageShell({
    title: "Tags",
    root: "../",
    body: `<header><h1>Tags</h1></header>\n${cloud}`,
  });
}

function tagPage(tag: string, files: FileInfo[]): string {
  const sorted = [...files].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return a.title.localeCompare(b.title);
  });
  const items = sorted
    .map((f) => {
      const meta = [f.date, f.summary].filter(Boolean).join(" — ");
      return `<li>
  <a href="../${f.htmlRelPath}">${f.title}</a>
  ${meta ? `<div class="file-meta">${meta}</div>` : ""}
</li>`;
    })
    .join("");
  return pageShell({
    title: `Tag: ${tag}`,
    root: "../",
    navExtra: `<a href="index.html">All tags</a>`,
    body: `<header><h1>${tag}</h1></header>\n<ul class="file-list">${items}</ul>`,
  });
}

async function generate(workspace: string, output: string): Promise<void> {
  console.log("Generating static site...");

  const glob = new Bun.Glob("**/*.md");
  const rawFiles: RawFile[] = [];
  let hasIndexMd = false;

  // Pass 1: collect raw data (all paths must be known before resolving wikilinks)
  for await (const relPath of glob.scan({ cwd: workspace, dot: false })) {
    if (relPath.startsWith(".episteme/")) continue;

    const absPath = path.join(workspace, relPath);
    const raw = await Bun.file(absPath).text();

    const { yaml, body } = parseFrontmatter(raw);
    const fields = yaml ? parseYamlFields(yaml) : {};

    const tagsRaw = fields["tags"];
    const tags: string[] = Array.isArray(tagsRaw) ? tagsRaw.map(String) : [];

    const dateRaw = fields["date"];
    const date = typeof dateRaw === "string" ? dateRaw : null;

    const summaryRaw = fields["summary"];
    const summary = typeof summaryRaw === "string" ? summaryRaw : null;

    const titleRaw = fields["title"];
    const title =
      (typeof titleRaw === "string" ? titleRaw : null) ??
      titleFromMarkdown(body) ??
      titleFromPath(relPath);

    if (relPath === "index.md") hasIndexMd = true;

    rawFiles.push({ relPath, body, title, tags, date, summary });
  }

  const allRelPaths = rawFiles.map((f) => f.relPath);

  // Pass 2: resolve wikilinks, render markdown, build FileInfo
  const files: FileInfo[] = [];
  for (const raw of rawFiles) {
    const resolvedBody = resolveWikilinksInBody(raw.body, allRelPaths, raw.relPath);
    const html = await marked(resolvedBody);
    const depth = raw.relPath.split("/").length - 1;
    const htmlRelPath = raw.relPath.replace(/\.md$/, ".html");
    files.push({ ...raw, html, depth, htmlRelPath });
  }

  // Write individual pages
  for (const file of files) {
    const outPath = path.join(output, file.htmlRelPath);
    await mkdir(path.dirname(outPath), { recursive: true });
    const root = pathToRoot(file.depth);
    await writeFile(outPath, contentPage(file, root), "utf8");
    console.log(`Writing ${file.htmlRelPath}`);
  }

  // Auto-index if no index.md
  if (!hasIndexMd) {
    const indexPath = path.join(output, "index.html");
    await writeFile(indexPath, autoIndexPage(files), "utf8");
    console.log("Writing index.html (auto-generated)");
  }

  // Tag pages
  const tagMap = new Map<string, FileInfo[]>();
  for (const file of files) {
    for (const tag of file.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(file);
    }
  }

  if (tagMap.size > 0) {
    await mkdir(path.join(output, "tags"), { recursive: true });

    const tagCounts = new Map([...tagMap.entries()].map(([t, fs]) => [t, fs.length]));
    await writeFile(path.join(output, "tags", "index.html"), tagIndexPage(tagCounts), "utf8");
    console.log("Writing tags/index.html");

    for (const [tag, tagFiles] of tagMap) {
      const slug = slugify(tag);
      await writeFile(path.join(output, "tags", `${slug}.html`), tagPage(tag, tagFiles), "utf8");
      console.log(`Writing tags/${slug}.html`);
    }
  }

  const total = files.length + (hasIndexMd ? 0 : 1) + (tagMap.size > 0 ? tagMap.size + 1 : 0);
  console.log(`Done. ${total} pages written.`);
}

// CLI entry point
const args = process.argv.slice(2);
const workspace = args.find((a) => a.startsWith("--workspace="))?.slice("--workspace=".length);
const output = args.find((a) => a.startsWith("--output="))?.slice("--output=".length);

if (!workspace || !output) {
  console.error("Usage: bun generate.ts --workspace=PATH --output=PATH");
  process.exit(1);
}

generate(workspace, output).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
