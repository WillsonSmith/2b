import type { AgentPlugin, ToolDefinition } from "@2b/framework/core/Plugin.ts";
import type { BaseAgent } from "@2b/framework/core/BaseAgent.ts";
import type { CortexMemoryPlugin } from "@2b/framework/plugins/CortexMemoryPlugin.ts";
import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import { logger } from "@2b/framework/logger.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import type { WorkspaceDb } from "../db/workspaceDb.ts";

const TAG = "ContradictionScanner";
const DEFAULT_WINDOW = 15;
const DEFAULT_STRIDE = Math.ceil(DEFAULT_WINDOW / 2);
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const META_LAST_SCAN_KEY = "contradiction_last_scan_at";

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

/**
 * Owns contradiction detection across the workspace memory + structural store.
 *
 * - Background scan runs every 30 min via scheduleProactiveTick (configured
 *   in onInit, after the agent has started).
 * - Same scan is also exposed as a callable tool for the agent.
 * - listContradictions is a sync read-only view.
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
    const intervalMs = this.config.contradictionScan?.intervalMs ?? DEFAULT_INTERVAL_MS;
    agent.scheduleProactiveTick(intervalMs, () => {
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
    return "You can scan workspace memories for logical contradictions and list known contradictions.";
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
    ];
  }

  async executeTool(name: string, _args: Record<string, unknown>): Promise<unknown> {
    if (name === "scan_contradictions") {
      const found = await this.runScan();
      return { found: found.length, contradictions: found };
    }
    if (name === "list_contradictions") return { contradictions: this.listContradictions() };
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
    const window = this.config.contradictionScan?.window ?? DEFAULT_WINDOW;
    const stride = this.config.contradictionScan?.stride ?? DEFAULT_STRIDE;

    const lastScanRaw = this.workspaceDb.getMeta(META_LAST_SCAN_KEY);
    const lastScanAt = lastScanRaw ? Number(lastScanRaw) : 0;
    const scanStartedAt = Date.now();

    const filter: Parameters<typeof this.memory.queryMemoriesRaw>[0] = {
      types: ["factual"],
      limit: 100,
    };
    if (lastScanAt > 0) filter.after = lastScanAt;
    const candidates = this.memory.queryMemoriesRaw(filter);

    if (candidates.length < 2) {
      // Still bump the marker so future runs only see truly newer memories.
      this.workspaceDb.setMeta(META_LAST_SCAN_KEY, String(scanStartedAt));
      return [];
    }

    logger.info(TAG, `Scanning ${candidates.length} factual memories for contradictions (after=${lastScanAt})`);

    const results: ContradictionRecord[] = [];

    for (let i = 0; i < candidates.length; i += stride) {
      const batch = candidates.slice(i, i + window);
      if (batch.length < 2) continue;

      const prompt = batch
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
        const memA = batch[pair.indexA];
        const memB = batch[pair.indexB];
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

    this.workspaceDb.setMeta(META_LAST_SCAN_KEY, String(scanStartedAt));
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

}
