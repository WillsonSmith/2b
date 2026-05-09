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

const MERMAID_SCRIPT = `<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>`;

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --accent: #2563eb;
    --border: #e5e7eb; --tag-bg: #f3f4f6; --tag-fg: #374151;
    --code-bg: #f9fafb; --max-w: 720px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a; --fg: #e2e8f0; --muted: #94a3b8; --accent: #60a5fa;
      --border: #1e293b; --tag-bg: #1e293b; --tag-fg: #cbd5e1;
      --code-bg: #1e293b;
    }
  }
  body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.65; padding: 2rem 1rem; }
  nav { max-width: var(--max-w); margin: 0 auto 2rem; }
  nav a { color: var(--accent); text-decoration: none; font-size: 0.9rem; }
  nav a:hover { text-decoration: underline; }
  article { max-width: var(--max-w); margin: 0 auto; }
  header { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
  h1 { font-size: 1.875rem; font-weight: 700; line-height: 1.25; margin-bottom: 0.75rem; }
  h2 { font-size: 1.375rem; font-weight: 600; margin: 1.75rem 0 0.75rem; }
  h3 { font-size: 1.125rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
  h4, h5, h6 { font-weight: 600; margin: 1.25rem 0 0.5rem; }
  p { margin-bottom: 1rem; }
  a { color: var(--accent); }
  ul, ol { padding-left: 1.5rem; margin-bottom: 1rem; }
  li { margin-bottom: 0.25rem; }
  time { display: block; color: var(--muted); font-size: 0.875rem; margin-bottom: 0.75rem; }
  .summary { color: var(--muted); font-style: italic; margin-bottom: 1rem; }
  .tags { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
  .tags li a { display: inline-block; background: var(--tag-bg); color: var(--tag-fg); border-radius: 9999px; padding: 0.2rem 0.65rem; font-size: 0.8rem; text-decoration: none; }
  .tags li a:hover { background: var(--accent); color: #fff; }
  code { font-family: ui-monospace, monospace; font-size: 0.875em; background: var(--code-bg); border: 1px solid var(--border); border-radius: 3px; padding: 0.15em 0.35em; }
  pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; overflow-x: auto; margin-bottom: 1rem; }
  pre code { background: none; border: none; padding: 0; }
  blockquote { border-left: 3px solid var(--border); margin: 1rem 0; padding: 0.5rem 1rem; color: var(--muted); }
  hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  img { max-width: 100%; height: auto; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.9rem; }
  th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
  th { background: var(--tag-bg); font-weight: 600; }
  .file-list { list-style: none; padding: 0; }
  .file-list li { padding: 0.4rem 0; border-bottom: 1px solid var(--border); }
  .file-list li:last-child { border-bottom: none; }
  .file-list a { text-decoration: none; color: var(--accent); font-weight: 500; }
  .file-list a:hover { text-decoration: underline; }
  .file-meta { font-size: 0.8rem; color: var(--muted); margin-top: 0.15rem; }
  .section-header { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 2rem 0 0.75rem; }
  .tag-cloud { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 2rem; }
  .tag-cloud a { display: inline-flex; align-items: center; gap: 0.3rem; background: var(--tag-bg); color: var(--tag-fg); border-radius: 9999px; padding: 0.3rem 0.8rem; font-size: 0.875rem; text-decoration: none; }
  .tag-cloud a:hover { background: var(--accent); color: #fff; }
  .tag-count { opacity: 0.65; font-size: 0.75em; }
  .mermaid { overflow-x: auto; margin-bottom: 1rem; text-align: center; }
  .wikilink-broken { color: var(--muted); border-bottom: 1px dashed currentColor; cursor: help; }
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
