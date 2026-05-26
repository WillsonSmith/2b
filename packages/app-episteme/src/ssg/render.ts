import * as path from "path";
import { CSS, MERMAID_SCRIPT, THEME_INIT_SCRIPT, THEME_TOGGLE_SCRIPT } from "./assets";

// Matches standard markdown links: [text](href)
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]*)\)/g;

export function isLocalHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) return false;
  if (href.startsWith("mailto:") || href.startsWith("#") || href.startsWith("//")) return false;
  return true;
}

export function resolveMarkdownLinkInSsg(
  href: string,
  currentRelPath: string,
  allRelPaths: string[],
): string | null {
  const [hrefNoFrag] = href.split("#");
  if (!hrefNoFrag) return null;
  const dir = path.dirname(currentRelPath);
  const raw = path.normalize(path.join(dir === "." ? "" : dir, hrefNoFrag));
  if (allRelPaths.includes(raw)) return raw;
  const withMd = raw.endsWith(".md") ? raw : raw + ".md";
  if (allRelPaths.includes(withMd)) return withMd;
  return null;
}

export interface RawFile {
  relPath: string;
  body: string;
  title: string;
  titleFromH1: boolean;
  tags: string[];
  date: string | null;
  summary: string | null;
}

export interface FileInfo {
  relPath: string;
  htmlRelPath: string;
  title: string;
  tags: string[];
  date: string | null;
  summary: string | null;
  html: string;
  hasMermaid: boolean;
  depth: number;
  edges: string[]; // htmlRelPaths of link targets
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function pathToRoot(depth: number): string {
  return depth === 0 ? "" : "../".repeat(depth);
}

export function titleFromPath(relPath: string): string {
  const stem = path.basename(relPath, ".md");
  return stem.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function titleFromMarkdown(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

export function relativeHref(fromRelPath: string, toRelPath: string): string {
  const fromDir = path.dirname(fromRelPath);
  return path.relative(fromDir === "." ? "" : fromDir, toRelPath).replace(/\\/g, "/");
}

export function extractEdgesForFile(body: string, allRelPaths: string[], currentHtmlRelPath: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const currentRelPath = currentHtmlRelPath.replace(/\.html$/, ".md");

  for (const match of body.matchAll(new RegExp(MARKDOWN_LINK_RE.source, "g"))) {
    const href = match[2];
    if (!href || !isLocalHref(href)) continue;
    const resolved = resolveMarkdownLinkInSsg(href, currentRelPath, allRelPaths);
    if (resolved) {
      const htmlPath = resolved.replace(/\.md$/, ".html");
      if (!seen.has(htmlPath) && htmlPath !== currentHtmlRelPath) {
        seen.add(htmlPath);
        result.push(htmlPath);
      }
    }
  }

  return result;
}

export function pageShell(opts: {
  title: string;
  root: string;
  navExtra?: string;
  body: string;
  hasMermaid?: boolean;
  pagefindBody?: boolean;
}): string {
  const articleAttrs = opts.pagefindBody ? ` data-pagefind-body` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
${THEME_INIT_SCRIPT}
${opts.hasMermaid ? MERMAID_SCRIPT : ""}
<link href="${opts.root}pagefind/pagefind-component-ui.css" rel="stylesheet">
<script src="${opts.root}pagefind/pagefind-component-ui.js" type="module"></script>
<style>${CSS}</style>
</head>
<body>
<nav data-pagefind-ignore>
  <div class="nav-links">
    <a href="${opts.root}index.html">← Home</a> · <a href="${opts.root}graph.html">Graph</a>${opts.navExtra ? ` · ${opts.navExtra}` : ""}
  </div>
  <div class="nav-actions">
    <pagefind-modal-trigger compact></pagefind-modal-trigger>
    <button id="ssg-theme-btn" onclick="ssgToggleTheme()" title="Toggle light/dark mode">☀</button>
  </div>
</nav>
<article${articleAttrs}>
${opts.body}
</article>
<pagefind-modal reset-on-close></pagefind-modal>
${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}

export function contentPage(file: FileInfo, root: string): string {
  const tagsHtml =
    file.tags.length > 0
      ? `<ul class="tags">${file.tags
          .map(
            (t) =>
              `<li><a href="${root}tags/${slugify(t)}.html" data-pagefind-filter="tag">${escapeHtml(t)}</a></li>`,
          )
          .join("")}</ul>`
      : "";
  const dateHtml = file.date
    ? `<time data-pagefind-meta="date">${escapeHtml(file.date)}</time>`
    : "";
  const summaryHtml = file.summary
    ? `<p class="summary" data-pagefind-meta="summary">${escapeHtml(file.summary)}</p>`
    : "";

  const header = `<header>
<h1>${escapeHtml(file.title)}</h1>
${dateHtml}
${tagsHtml}
${summaryHtml}
</header>`;

  return pageShell({
    title: escapeHtml(file.title),
    root,
    navExtra: file.tags
      .map((t) => `<a href="${root}tags/${slugify(t)}.html">${escapeHtml(t)}</a>`)
      .join(", ") || undefined,
    body: `${header}\n${file.html}`,
    hasMermaid: file.hasMermaid,
    pagefindBody: true,
  });
}

export function autoIndexPage(files: FileInfo[]): string {
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
      sectionsHtml += `<p class="section-header">${escapeHtml(dir.replace(/\//g, " / "))}</p>`;
    }
    sectionsHtml += `<ul class="file-list">`;
    for (const f of sectionFiles) {
      const meta = [f.date, f.summary].filter((v): v is string => Boolean(v)).map(escapeHtml).join(" — ");
      sectionsHtml += `<li>
  <a href="${encodeURI(f.htmlRelPath)}">${escapeHtml(f.title)}</a>
  ${meta ? `<div class="file-meta">${meta}</div>` : ""}
</li>`;
    }
    sectionsHtml += `</ul>`;
  }

  let tagCloudHtml = "";
  if (allTags.size > 0) {
    const sortedTags = [...allTags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    tagCloudHtml = `<details class="tags-section"><summary>Tags</summary><div class="tag-cloud">${sortedTags
      .map(([t, n]) => `<a href="tags/${slugify(t)}.html">${escapeHtml(t)} <span class="tag-count">${n}</span></a>`)
      .join("")}</div></details>`;
  }

  return pageShell({
    title: "Index",
    root: "",
    body: `<header><h1>Index</h1></header>\n${tagCloudHtml}\n${sectionsHtml}`,
  });
}

export function tagIndexPage(tagCounts: Map<string, number>): string {
  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cloud = `<div class="tag-cloud">${sorted
    .map(([t, n]) => `<a href="${slugify(t)}.html">${escapeHtml(t)} <span class="tag-count">${n}</span></a>`)
    .join("")}</div>`;
  return pageShell({
    title: "Tags",
    root: "../",
    body: `<header><h1>Tags</h1></header>\n${cloud}`,
  });
}

export function tagPage(tag: string, files: FileInfo[]): string {
  const sorted = [...files].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return a.title.localeCompare(b.title);
  });
  const items = sorted
    .map((f) => {
      const meta = [f.date, f.summary].filter((v): v is string => Boolean(v)).map(escapeHtml).join(" — ");
      return `<li>
  <a href="../${encodeURI(f.htmlRelPath)}">${escapeHtml(f.title)}</a>
  ${meta ? `<div class="file-meta">${meta}</div>` : ""}
</li>`;
    })
    .join("");
  return pageShell({
    title: `Tag: ${escapeHtml(tag)}`,
    root: "../",
    navExtra: `<a href="index.html">All tags</a>`,
    body: `<header><h1>${escapeHtml(tag)}</h1></header>\n<ul class="file-list">${items}</ul>`,
  });
}

export function graphPage(files: FileInfo[]): string {
  const nodes = files.map((f) => ({ id: f.htmlRelPath, title: f.title, tags: f.tags }));

  const linkSet = new Set<string>();
  const links: { source: string; target: string }[] = [];
  for (const f of files) {
    for (const target of f.edges) {
      const key = `${f.htmlRelPath}\0${target}`;
      if (!linkSet.has(key)) {
        linkSet.add(key);
        links.push({ source: f.htmlRelPath, target });
      }
    }
  }

  const summary = `${files.length} note${files.length !== 1 ? "s" : ""} · ${links.length} connection${links.length !== 1 ? "s" : ""}`;

  const graphScript = `<script>
const GRAPH_NODES = ${JSON.stringify(nodes).replace(/<\//g, "<\\/")};
const GRAPH_LINKS = ${JSON.stringify(links).replace(/<\//g, "<\\/")};
</script>
<script type="module">
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const wrap = document.getElementById('graph-wrap');
const svg = d3.select('#graph-svg');
let W = wrap.clientWidth, H = wrap.clientHeight;

const degree = new Map(GRAPH_NODES.map(n => [n.id, 0]));
for (const l of GRAPH_LINKS) {
  degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
  degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
}
const nodeR = d => Math.max(4, Math.min(12, 4 + (degree.get(d.id) ?? 0)));

const nodes = GRAPH_NODES.map(d => ({ ...d }));
const links = GRAPH_LINKS.map(d => ({ ...d }));

const sim = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(80))
  .force('charge', d3.forceManyBody().strength(-220))
  .force('center', d3.forceCenter(W / 2, H / 2))
  .force('collide', d3.forceCollide().radius(d => nodeR(d) + 5));

const zoom = d3.zoom().scaleExtent([0.05, 10]).on('zoom', e => g.attr('transform', e.transform));
svg.call(zoom);
svg.on('dblclick.zoom', () => svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity));

const g = svg.append('g');

const link = g.append('g')
  .selectAll('line')
  .data(links)
  .join('line')
  .style('stroke', 'var(--text-dim)')
  .style('stroke-opacity', '0.75')
  .style('stroke-width', '1.5');

const node = g.append('g')
  .selectAll('g')
  .data(nodes)
  .join('g')
  .style('cursor', 'pointer')
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
  .on('click', (e, d) => { window.location.href = d.id; });

node.append('circle')
  .attr('r', nodeR)
  .style('fill', 'var(--bg-raised)')
  .style('stroke', 'var(--accent)')
  .style('stroke-width', '1.5');

node.append('text')
  .text(d => d.title)
  .attr('dy', '0.35em')
  .style('font-size', '10px')
  .style('fill', 'var(--text-muted)')
  .style('pointer-events', 'none')
  .style('user-select', 'none')
  .each(function(d) { this.setAttribute('dx', String(nodeR(d) + 4)); });

node.append('title').text(d => d.title + (d.tags.length ? '\\n' + d.tags.join(', ') : ''));

sim.on('tick', () => {
  link
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
});

new ResizeObserver(() => {
  W = wrap.clientWidth; H = wrap.clientHeight;
  svg.attr('width', W).attr('height', H);
  sim.force('center', d3.forceCenter(W / 2, H / 2)).alpha(0.3).restart();
}).observe(wrap);
</script>`;

  return pageShell({
    title: "Knowledge Graph",
    root: "",
    body: `<header>
<h1>Knowledge Graph</h1>
<p class="summary">${summary}</p>
</header>
<div id="graph-wrap" style="width:100%;height:72vh;background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--md-radius-md);overflow:hidden;position:relative">
  <svg id="graph-svg" style="width:100%;height:100%"></svg>
</div>
<p style="font-size:var(--md-scale-xs);color:var(--text-dim);margin-top:var(--md-sp2)">Click a node to navigate · Scroll to zoom · Drag to pan · Double-click to reset view</p>
${graphScript}`,
  });
}
