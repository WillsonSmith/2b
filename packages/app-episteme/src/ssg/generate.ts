import { parseFrontmatter, parseYamlFields } from "../features/frontmatter";
import { marked } from "marked";
import * as path from "path";
import { mkdir, writeFile } from "fs/promises";
import {
  type RawFile,
  type FileInfo,
  slugify,
  titleFromMarkdown,
  titleFromPath,
  pathToRoot,
  extractEdgesForFile,
  resolveWikilinksInBody,
  contentPage,
  autoIndexPage,
  tagIndexPage,
  tagPage,
  graphPage,
} from "./render";

// Render mermaid fenced blocks as <div class="mermaid"> instead of <pre><code>
marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang === "mermaid") return `<div class="mermaid">${text}</div>\n`;
      return false;
    },
  },
});

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
    const frontmatterTitle = typeof titleRaw === "string" ? titleRaw : null;
    const h1Title = frontmatterTitle === null ? titleFromMarkdown(body) : null;
    const title = frontmatterTitle ?? h1Title ?? titleFromPath(relPath);
    const titleFromH1 = h1Title !== null;

    if (relPath === "index.md") hasIndexMd = true;

    rawFiles.push({ relPath, body, title, titleFromH1, tags, date, summary });
  }

  const allRelPaths = rawFiles.map((f) => f.relPath);

  // Pass 2: resolve wikilinks, render markdown, build FileInfo
  const files: FileInfo[] = [];
  for (const raw of rawFiles) {
    let processedBody = raw.body;
    if (raw.titleFromH1) {
      const h1Match = processedBody.match(/^#\s+(.+)$/m);
      if (h1Match) {
        processedBody = processedBody.replace(h1Match[0], "").trimStart();
      }
    }

    const resolvedBody = resolveWikilinksInBody(processedBody, allRelPaths, raw.relPath);
    const html = await marked(resolvedBody);
    const hasMermaid = html.includes('class="mermaid"');

    const depth = raw.relPath.split("/").length - 1;
    const htmlRelPath = raw.relPath.replace(/\.md$/, ".html");

    const edges = extractEdgesForFile(processedBody, allRelPaths, htmlRelPath);

    files.push({
      relPath: raw.relPath,
      htmlRelPath,
      title: raw.title,
      tags: raw.tags,
      date: raw.date,
      summary: raw.summary,
      html,
      hasMermaid,
      depth,
      edges,
    });
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

  // Knowledge graph
  await writeFile(path.join(output, "graph.html"), graphPage(files), "utf8");
  console.log("Writing graph.html");

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

  const total = files.length + (hasIndexMd ? 0 : 1) + 1 + (tagMap.size > 0 ? tagMap.size + 1 : 0);
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
