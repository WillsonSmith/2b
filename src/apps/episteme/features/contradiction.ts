import type { CortexMemoryPlugin } from "../../../plugins/CortexMemoryPlugin.ts";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import { logger } from "../../../logger.ts";

const TAG = "ContradictionScanner";
const WINDOW = 15; // memories per batch sent to the LLM
// Step by half-window so adjacent batches overlap — ensures pairs spanning a
// batch boundary are still compared against each other.
const STRIDE = Math.ceil(WINDOW / 2);

const SYSTEM = `You are a research assistant analyzing statements for definite logical contradictions.
A contradiction is when two statements assert directly opposing facts — not just different perspectives, emphasis, or levels of detail.

Given a numbered list of statements, identify pairs that DEFINITIVELY contradict each other.

Respond with a JSON array:
[
  { "indexA": 0, "indexB": 2, "summary": "One sentence describing the contradiction" }
]

If no pairs contradict, return: []
Return ONLY valid JSON. No preamble or markdown fences.`;

export interface ContradictionRecord {
  id: string;
  summary: string;
  sourceAId: string;
  sourceBId: string;
  sourceAText: string;
  sourceBText: string;
  timestamp: number;
}

export async function runContradictionScan(
  memory: CortexMemoryPlugin,
  config: EpistemeConfig,
): Promise<ContradictionRecord[]> {
  const allMemories = memory.queryMemoriesRaw({
    types: ["factual"],
    limit: 100,
  });

  // Exclude existing contradiction records to avoid recursion
  const candidates = allMemories.filter((m) => !m.tags.includes("contradiction"));
  if (candidates.length < 2) return [];

  logger.info(TAG, `Scanning ${candidates.length} factual memories for contradictions`);

  const llm = createProvider(featureModel(config, "research"));
  const results: ContradictionRecord[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < candidates.length; i += STRIDE) {
    const window = candidates.slice(i, i + WINDOW);
    if (window.length < 2) continue;

    const prompt = window
      .map((m, idx) => `[${idx}] ${m.text.replace(/\n+/g, " ").slice(0, 300)}`)
      .join("\n\n");

    let pairs: Array<{ indexA: number; indexB: number; summary: string }> = [];
    try {
      const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: TAG });
      const raw = await agent.ask(`Analyze for definite contradictions:\n\n${prompt}`);
      // Extract JSON array — model may include extra text despite instructions
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) pairs = JSON.parse(jsonMatch[0]);
    } catch (err) {
      logger.warn(TAG, `Batch ${i} parse error: ${err}`);
      continue;
    }

    for (const pair of pairs) {
      const memA = window[pair.indexA];
      const memB = window[pair.indexB];
      if (!memA || !memB) continue;

      const pairKey = [memA.id, memB.id].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const summaryText = pair.summary?.trim() ?? "Contradiction detected";
      const contradictionText =
        `CONTRADICTION\n\nSummary: ${summaryText}\n\n` +
        `Source A (id:${memA.id}): ${memA.text.slice(0, 400)}\n\n` +
        `Source B (id:${memB.id}): ${memB.text.slice(0, 400)}`;

      const newId = await memory.writeMemory(
        contradictionText,
        "factual",
        ["contradiction", `source_a:${memA.id}`, `source_b:${memB.id}`],
        "episteme",
      );

      await memory.linkMemories(memA.id, memB.id, "contradicts");

      logger.info(TAG, `Contradiction found: "${summaryText.slice(0, 60)}"`);

      results.push({
        id: newId ?? pairKey,
        summary: summaryText,
        sourceAId: memA.id,
        sourceBId: memB.id,
        sourceAText: memA.text.replace(/\n+/g, " ").slice(0, 300),
        sourceBText: memB.text.replace(/\n+/g, " ").slice(0, 300),
        timestamp: Date.now(),
      });
    }
  }

  logger.info(TAG, `Scan complete — ${results.length} new contradictions found`);
  return results;
}

export function queryContradictions(memory: CortexMemoryPlugin): ContradictionRecord[] {
  const memories = memory.queryMemoriesRaw({
    tags: ["contradiction"],
    limit: 50,
  });

  return memories
    .filter((m) => m.text.startsWith("CONTRADICTION"))
    .map((m) => {
      const sourceATag = m.tags.find((t) => t.startsWith("source_a:"));
      const sourceBTag = m.tags.find((t) => t.startsWith("source_b:"));
      const sourceAId = sourceATag?.slice("source_a:".length) ?? "";
      const sourceBId = sourceBTag?.slice("source_b:".length) ?? "";

      const summaryMatch = m.text.match(/Summary: ([^\n]+)/);
      const aMatch = m.text.match(/Source A[^:]*: ([^\n]+(?:\n(?!Source)[^\n]+)*)/);
      const bMatch = m.text.match(/Source B[^:]*: ([^\n]+(?:\n(?!Source)[^\n]+)*)/);

      return {
        id: m.id,
        summary: summaryMatch?.[1]?.trim() ?? "Contradiction",
        sourceAId,
        sourceBId,
        sourceAText: aMatch?.[1]?.trim().slice(0, 300) ?? "",
        sourceBText: bMatch?.[1]?.trim().slice(0, 300) ?? "",
        timestamp: m.timestamp,
      };
    });
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  file?: string;
  color: string;
}

export interface GraphLink {
  source: string;
  target: string;
  linkType: string;
  color: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const NODE_COLORS: Record<string, string> = {
  "workspace-file": "#5588cc",
  contradiction: "#cc5555",
  factual: "#666680",
};

function extractDocumentLinks(content: string): string[] {
  const refs = new Set<string>();
  for (const m of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const name = (m[1] ?? "").trim().toLowerCase();
    if (name) refs.add(name);
  }
  for (const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = (m[1] ?? "").trim();
    if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) continue;
    const filename = href.split("/").at(-1)?.replace(/\.md$/i, "").toLowerCase() ?? "";
    if (filename) refs.add(filename);
  }
  return [...refs];
}

export function buildKnowledgeGraph(memory: CortexMemoryPlugin): GraphData {
  const allFactual = memory.queryMemoriesRaw({ types: ["factual"], limit: 150 });

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  for (const m of allFactual) {
    if (m.tags.includes("contradiction")) continue; // handled separately
    const isFile = m.tags.includes("workspace-file");
    const filePath = isFile ? m.tags.find((t) => t !== "workspace-file") : undefined;
    const label = filePath
      ? filePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? filePath
      : m.text.split("\n")[0]?.slice(0, 50) ?? m.id.slice(0, 8);

    nodes.push({
      id: m.id,
      label,
      type: isFile ? "workspace-file" : "factual",
      file: filePath,
      color: NODE_COLORS[isFile ? "workspace-file" : "factual"] ?? NODE_COLORS["factual"]!,
    });
    nodeIds.add(m.id);
  }

  // Build edges from document cross-references (wikilinks and markdown links)
  const fileNodeByBasename = new Map<string, string>();
  for (const n of nodes) {
    if (n.type !== "workspace-file") continue;
    const basename = (n.file ?? n.label).split("/").at(-1)?.replace(/\.md$/i, "").toLowerCase() ?? "";
    if (basename) fileNodeByBasename.set(basename, n.id);
  }

  const seenDocLinks = new Set<string>();
  for (const m of allFactual) {
    if (!m.tags.includes("workspace-file")) continue;
    if (!nodeIds.has(m.id)) continue;
    for (const ref of extractDocumentLinks(m.text)) {
      const targetId = fileNodeByBasename.get(ref);
      if (!targetId || targetId === m.id) continue;
      const edgeKey = `${m.id}→${targetId}`;
      if (seenDocLinks.has(edgeKey)) continue;
      seenDocLinks.add(edgeKey);
      links.push({ source: m.id, target: targetId, linkType: "document-link", color: "#55cc88" });
    }
  }

  // Build edges from contradiction records
  const contradictions = allFactual.filter((m) => m.tags.includes("contradiction"));
  for (const c of contradictions) {
    const sourceATag = c.tags.find((t) => t.startsWith("source_a:"));
    const sourceBTag = c.tags.find((t) => t.startsWith("source_b:"));
    const idA = sourceATag?.slice("source_a:".length);
    const idB = sourceBTag?.slice("source_b:".length);

    if (idA && idB && nodeIds.has(idA) && nodeIds.has(idB)) {
      links.push({ source: idA, target: idB, linkType: "contradicts", color: "#cc5555" });
    }

    // Add contradiction node itself
    const summaryMatch = c.text.match(/Summary: ([^\n]+)/);
    const label = summaryMatch?.[1]?.slice(0, 40) ?? "Contradiction";
    nodes.push({
      id: c.id,
      label,
      type: "contradiction",
      color: NODE_COLORS["contradiction"]!,
    });
    nodeIds.add(c.id);

    if (idA && nodeIds.has(idA)) {
      links.push({ source: c.id, target: idA, linkType: "contradicts", color: "#cc5555" });
    }
    if (idB && nodeIds.has(idB)) {
      links.push({ source: c.id, target: idB, linkType: "contradicts", color: "#cc5555" });
    }
  }

  return { nodes, links };
}
