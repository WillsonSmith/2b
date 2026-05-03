import type { CortexMemoryPlugin } from "../../../plugins/CortexMemoryPlugin.ts";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import { logger } from "../../../logger.ts";
import type { WorkspaceDb } from "../db/workspaceDb.ts";

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
  workspaceDb: WorkspaceDb,
): Promise<ContradictionRecord[]> {
  const candidates = memory.queryMemoriesRaw({
    types: ["factual"],
    limit: 100,
  });

  if (candidates.length < 2) return [];

  logger.info(TAG, `Scanning ${candidates.length} factual memories for contradictions`);

  const llm = createProvider(featureModel(config, "research"));
  const results: ContradictionRecord[] = [];

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

      // Persistent dedupe across runs via the unique index on (source_a_id, source_b_id).
      if (workspaceDb.contradictionPairExists(memA.id, memB.id)) continue;

      const summaryText = pair.summary?.trim() ?? "Contradiction detected";
      const sourceAText = memA.text.replace(/\n+/g, " ").slice(0, 300);
      const sourceBText = memB.text.replace(/\n+/g, " ").slice(0, 300);

      const id = workspaceDb.recordContradiction({
        summary: summaryText,
        sourceAId: memA.id,
        sourceBId: memB.id,
        sourceAText,
        sourceBText,
      });

      // Keep the contradicts edge in the memory graph for downstream consumers.
      await memory.linkMemories(memA.id, memB.id, "contradicts");

      logger.info(TAG, `Contradiction found: "${summaryText.slice(0, 60)}"`);

      results.push({
        id,
        summary: summaryText,
        sourceAId: memA.id,
        sourceBId: memB.id,
        sourceAText,
        sourceBText,
        timestamp: Date.now(),
      });
    }
  }

  logger.info(TAG, `Scan complete — ${results.length} new contradictions found`);
  return results;
}

export function queryContradictions(workspaceDb: WorkspaceDb): ContradictionRecord[] {
  return workspaceDb.listContradictions(50).map((row) => ({
    id: row.id,
    summary: row.summary,
    sourceAId: row.sourceAId,
    sourceBId: row.sourceBId,
    sourceAText: row.sourceAText,
    sourceBText: row.sourceBText,
    timestamp: row.createdAt,
  }));
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

export function buildKnowledgeGraph(
  memory: CortexMemoryPlugin,
  workspaceDb: WorkspaceDb,
): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  // 1. Workspace file nodes — keyed by rel_path so node IDs survive re-indexing.
  for (const row of workspaceDb.listWorkspaceFiles()) {
    const id = `file:${row.relPath}`;
    const label = row.relPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? row.relPath;
    nodes.push({
      id,
      label,
      type: "workspace-file",
      file: row.relPath,
      color: NODE_COLORS["workspace-file"]!,
    });
    nodeIds.add(id);
  }

  // 2. File-to-file edges from pre-resolved link table.
  for (const link of workspaceDb.getAllLinks()) {
    const src = `file:${link.sourcePath}`;
    const tgt = `file:${link.targetPath}`;
    if (!nodeIds.has(src) || !nodeIds.has(tgt) || src === tgt) continue;
    links.push({ source: src, target: tgt, linkType: "document-link", color: "#55cc88" });
  }

  // 3. Non-file factual memory nodes (excluding legacy workspace-file/contradiction tags).
  // The contradiction-tag filter is vestigial — kept one release as a safety net for
  // databases that still contain old prose-encoded contradiction memories.
  const allFactual = memory.queryMemoriesRaw({ types: ["factual"], limit: 150 });
  for (const m of allFactual) {
    if (m.tags.includes("workspace-file")) continue;
    if (m.tags.includes("contradiction")) continue;
    const label = m.text.split("\n")[0]?.slice(0, 50) ?? m.id.slice(0, 8);
    nodes.push({
      id: m.id,
      label,
      type: "factual",
      color: NODE_COLORS["factual"]!,
    });
    nodeIds.add(m.id);
  }

  // 4. Contradiction nodes + edges. source_a_id / source_b_id reference memory IDs.
  for (const c of workspaceDb.listContradictions()) {
    const cid = `contradiction:${c.id}`;
    nodes.push({
      id: cid,
      label: c.summary.slice(0, 40),
      type: "contradiction",
      color: NODE_COLORS["contradiction"]!,
    });
    nodeIds.add(cid);

    if (nodeIds.has(c.sourceAId)) {
      links.push({ source: cid, target: c.sourceAId, linkType: "contradicts", color: "#cc5555" });
    }
    if (nodeIds.has(c.sourceBId)) {
      links.push({ source: cid, target: c.sourceBId, linkType: "contradicts", color: "#cc5555" });
    }
    if (nodeIds.has(c.sourceAId) && nodeIds.has(c.sourceBId)) {
      links.push({
        source: c.sourceAId,
        target: c.sourceBId,
        linkType: "contradicts",
        color: "#cc5555",
      });
    }
  }

  return { nodes, links };
}
