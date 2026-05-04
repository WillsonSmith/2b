import type { AgentPlugin, ToolDefinition } from "../../../core/Plugin.ts";
import type { BaseAgent } from "../../../core/BaseAgent.ts";
import type { CortexMemoryPlugin } from "../../../plugins/CortexMemoryPlugin.ts";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import { logger } from "../../../logger.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import type { WorkspaceDb } from "../db/workspaceDb.ts";

const TAG = "ContradictionScanner";
const WINDOW = 15;
const STRIDE = Math.ceil(WINDOW / 2);
const SCAN_INTERVAL_MS = 30 * 60 * 1000;

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

/**
 * Owns contradiction detection across the workspace memory + structural store.
 *
 * - Background scan runs every 30 min via scheduleProactiveTick (configured
 *   in onInit, after the agent has started).
 * - Same scan is also exposed as a callable tool for the agent.
 * - listContradictions / buildKnowledgeGraph are sync read-only views.
 */
export class ContradictionPlugin implements AgentPlugin {
  name = "Contradiction";

  private readonly memory: CortexMemoryPlugin;
  private readonly config: EpistemeConfig;
  private readonly workspaceDb: WorkspaceDb;
  private scannerAgent: HeadlessAgent | null = null;

  constructor(
    memory: CortexMemoryPlugin,
    config: EpistemeConfig,
    workspaceDb: WorkspaceDb,
  ) {
    this.memory = memory;
    this.config = config;
    this.workspaceDb = workspaceDb;
  }

  onInit(agent: BaseAgent): void {
    agent.scheduleProactiveTick(SCAN_INTERVAL_MS, () => {
      this.runScan().then((found) => {
        if (found.length > 0) {
          logger.info("Episteme", `Background scan found ${found.length} new contradiction(s)`);
        }
      }).catch((err) => {
        logger.warn("Episteme", `Background contradiction scan failed: ${err}`);
      });
      return null;
    });
  }

  getSystemPromptFragment(): string {
    return "You can scan workspace memories for logical contradictions, list known contradictions, and build a knowledge graph linking files, facts, and conflicts.";
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "scan_contradictions",
        description:
          "Scan all factual workspace memories for definite logical contradictions and persist any found.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "list_contradictions",
        description: "Return previously detected contradictions stored in the workspace database.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "build_knowledge_graph",
        description:
          "Build a knowledge graph of files, facts, and contradictions. Returns nodes and links suitable for visualisation.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    ];
  }

  async executeTool(name: string, _args: Record<string, unknown>): Promise<unknown> {
    if (name === "scan_contradictions") {
      const found = await this.runScan();
      return { found: found.length, contradictions: found };
    }
    if (name === "list_contradictions") return { contradictions: this.listContradictions() };
    if (name === "build_knowledge_graph") return this.buildKnowledgeGraph();
  }

  // ── public methods (called by server handlers + tools) ────────────────────

  private getScannerAgent(): HeadlessAgent {
    if (!this.scannerAgent) {
      const llm = createProvider(featureModel(this.config, "research"));
      this.scannerAgent = new HeadlessAgent(llm, [], SYSTEM, { agentName: TAG });
    }
    return this.scannerAgent;
  }

  async runScan(): Promise<ContradictionRecord[]> {
    const candidates = this.memory.queryMemoriesRaw({
      types: ["factual"],
      limit: 100,
    });

    if (candidates.length < 2) return [];

    logger.info(TAG, `Scanning ${candidates.length} factual memories for contradictions`);

    const results: ContradictionRecord[] = [];

    for (let i = 0; i < candidates.length; i += STRIDE) {
      const window = candidates.slice(i, i + WINDOW);
      if (window.length < 2) continue;

      const prompt = window
        .map((m, idx) => `[${idx}] ${m.text.replace(/\n+/g, " ").slice(0, 300)}`)
        .join("\n\n");

      let pairs: Array<{ indexA: number; indexB: number; summary: string }> = [];
      try {
        const raw = await this.getScannerAgent().ask(`Analyze for definite contradictions:\n\n${prompt}`);
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

        if (this.workspaceDb.contradictionPairExists(memA.id, memB.id)) continue;

        const summaryText = pair.summary?.trim() ?? "Contradiction detected";
        const sourceAText = memA.text.replace(/\n+/g, " ").slice(0, 300);
        const sourceBText = memB.text.replace(/\n+/g, " ").slice(0, 300);

        const id = this.workspaceDb.recordContradiction({
          summary: summaryText,
          sourceAId: memA.id,
          sourceBId: memB.id,
          sourceAText,
          sourceBText,
        });

        await this.memory.linkMemories(memA.id, memB.id, "contradicts");

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

  listContradictions(): ContradictionRecord[] {
    return this.workspaceDb.listContradictions(50).map((row) => ({
      id: row.id,
      summary: row.summary,
      sourceAId: row.sourceAId,
      sourceBId: row.sourceBId,
      sourceAText: row.sourceAText,
      sourceBText: row.sourceBText,
      timestamp: row.createdAt,
    }));
  }

  buildKnowledgeGraph(): GraphData {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();

    for (const row of this.workspaceDb.listWorkspaceFiles()) {
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

    for (const link of this.workspaceDb.getAllLinks()) {
      const src = `file:${link.sourcePath}`;
      const tgt = `file:${link.targetPath}`;
      if (!nodeIds.has(src) || !nodeIds.has(tgt) || src === tgt) continue;
      links.push({ source: src, target: tgt, linkType: "document-link", color: "#55cc88" });
    }

    // The contradiction-tag filter is vestigial — kept one release as a safety net for
    // databases that still contain old prose-encoded contradiction memories.
    const allFactual = this.memory.queryMemoriesRaw({ types: ["factual"], limit: 150 });
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

    for (const c of this.workspaceDb.listContradictions()) {
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
}
