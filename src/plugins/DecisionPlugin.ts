/**
 * DecisionPlugin — structured decision support with SQLite persistence.
 *
 * Tools:
 *   evaluate_options    — LLM-driven comparative analysis of two or more options
 *   record_decision     — persist a made decision (question, chosen option, rationale)
 *   get_decision_history — retrieve past decisions, optionally filtered
 *
 * `evaluate_options` is deliberative — it calls the LLM and does NOT automatically
 * persist. The agent can then call `record_decision` once it has made its choice.
 */
import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { join } from "node:path";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import { appDataPath } from "../paths.ts";
import { logger } from "../logger.ts";

export interface DecisionRecord {
  id: string;
  question: string;
  chosenOption: string;
  rationale: string;
  optionsConsidered: string[];
  createdAt: number;
}

export class DecisionPlugin implements AgentPlugin {
  name = "Decision";
  private db: Database;

  constructor(
    private readonly llm: LLMProvider,
    dbPath?: string,
  ) {
    const path = dbPath ?? join(appDataPath("data"), "decisions.sqlite");
    this.db = new Database(path, { create: true });
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        id                TEXT PRIMARY KEY,
        question          TEXT NOT NULL,
        chosen_option     TEXT NOT NULL,
        rationale         TEXT NOT NULL,
        options_considered TEXT NOT NULL,
        created_at        INTEGER NOT NULL
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at)`);
  }

  // ── Public read API ────────────────────────────────────────────────────────

  public getHistory(limit = 20): DecisionRecord[] {
    return this.db.query<{
      id: string;
      question: string;
      chosen_option: string;
      rationale: string;
      options_considered: string;
      created_at: number;
    }, [number]>(
      `SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?`,
    ).all(limit).map(r => ({
      id: r.id,
      question: r.question,
      chosenOption: r.chosen_option,
      rationale: r.rationale,
      optionsConsidered: JSON.parse(r.options_considered) as string[],
      createdAt: r.created_at,
    }));
  }

  public getById(id: string): DecisionRecord | null {
    const r = this.db.query<{
      id: string;
      question: string;
      chosen_option: string;
      rationale: string;
      options_considered: string;
      created_at: number;
    }, [string]>(
      `SELECT * FROM decisions WHERE id = ?`,
    ).get(id);
    if (!r) return null;
    return {
      id: r.id,
      question: r.question,
      chosenOption: r.chosen_option,
      rationale: r.rationale,
      optionsConsidered: JSON.parse(r.options_considered) as string[],
      createdAt: r.created_at,
    };
  }

  // ── Plugin hooks ───────────────────────────────────────────────────────────

  getSystemPromptFragment(): string {
    return [
      "## Decision Support",
      "Use these tools when you face a meaningful choice or need to document reasoning:",
      "  evaluate_options     — compare two or more options with LLM-driven analysis before deciding",
      "  record_decision      — persist the chosen option and rationale after deciding",
      "  get_decision_history — review past decisions for context or consistency",
      "Always record important decisions so they can be referenced later.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "evaluate_options",
        description:
          "Analyse two or more options for a given question using structured LLM reasoning. Returns a comparative analysis with a recommendation. Does NOT automatically record the decision.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The decision question or problem statement.",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "List of option names or brief descriptions to compare.",
            },
            context: {
              type: "string",
              description: "Optional additional context that should inform the analysis.",
            },
          },
          required: ["question", "options"],
        },
      },
      {
        name: "record_decision",
        description: "Persist a decision to the decision log. Call this after evaluate_options (or any other deliberation) once you have chosen an option.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The decision question.",
            },
            chosen_option: {
              type: "string",
              description: "The option that was selected.",
            },
            rationale: {
              type: "string",
              description: "Why this option was chosen.",
            },
            options_considered: {
              type: "array",
              items: { type: "string" },
              description: "All options that were considered (including the chosen one).",
            },
          },
          required: ["question", "chosen_option", "rationale"],
        },
      },
      {
        name: "get_decision_history",
        description: "Retrieve past decisions, most recent first.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of decisions to return. Default: 10.",
            },
            query: {
              type: "string",
              description: "Optional substring to filter decisions by question text.",
            },
          },
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "evaluate_options":    return this.handleEvaluateOptions(args);
      case "record_decision":     return this.handleRecordDecision(args);
      case "get_decision_history": return this.handleGetHistory(args);
      default:                    return undefined;
    }
  }

  // ── Tool handlers ──────────────────────────────────────────────────────────

  private async handleEvaluateOptions(args: Record<string, unknown>): Promise<string> {
    const question = String(args.question ?? "").trim();
    const options = Array.isArray(args.options) ? args.options.map(String) : [];
    const context = typeof args.context === "string" ? args.context.trim() : "";

    if (!question) return "evaluate_options error: question is required.";
    if (options.length < 2) return "evaluate_options error: at least two options are required.";

    const optionsList = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
    const contextSection = context ? `\nAdditional context:\n${context}\n` : "";

    const prompt = `You are a decision analysis assistant. Analyse the following options for the given question.

Question: ${question}
${contextSection}
Options:
${optionsList}

For each option, briefly list pros and cons (2-3 points each). Then state your recommendation and a one-sentence rationale.

Format your response as:
Option 1: <name>
  Pros: <brief list>
  Cons: <brief list>

[...repeat for each option...]

Recommendation: <option name>
Rationale: <one sentence>`;

    try {
      const { nonReasoningContent } = await this.llm.chat(
        [{ role: "user", content: prompt }],
        "You are a structured decision analysis assistant. Be concise and direct.",
      );
      const analysis = nonReasoningContent.trim();
      logger.info(this.name, `evaluate_options: analysed ${options.length} options for "${question.slice(0, 60)}"`);
      return `Decision analysis for: ${question}\n\n${analysis}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(this.name, "evaluate_options LLM call failed:", e);
      return `evaluate_options error: LLM call failed — ${msg}`;
    }
  }

  private handleRecordDecision(args: Record<string, unknown>): string {
    const question = String(args.question ?? "").trim();
    const chosenOption = String(args.chosen_option ?? "").trim();
    const rationale = String(args.rationale ?? "").trim();
    const optionsConsidered = Array.isArray(args.options_considered)
      ? args.options_considered.map(String)
      : [chosenOption];

    if (!question) return "record_decision error: question is required.";
    if (!chosenOption) return "record_decision error: chosen_option is required.";
    if (!rationale) return "record_decision error: rationale is required.";

    const id = randomUUID();
    const now = Date.now();
    this.db.run(
      `INSERT INTO decisions (id, question, chosen_option, rationale, options_considered, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, question, chosenOption, rationale, JSON.stringify(optionsConsidered), now],
    );

    logger.info(this.name, `record_decision: saved ${id.slice(0, 8)} — "${chosenOption}" for "${question.slice(0, 60)}"`);
    return `Decision recorded (id: ${id}).\nQuestion: ${question}\nChosen: ${chosenOption}\nRationale: ${rationale}`;
  }

  private handleGetHistory(args: Record<string, unknown>): string {
    const limit = typeof args.limit === "number" ? Math.min(Math.max(1, Math.floor(args.limit)), 50) : 10;
    const query = typeof args.query === "string" ? args.query.trim() : "";

    let records = this.getHistory(limit * 2); // fetch extra for filtering
    if (query) {
      const lower = query.toLowerCase();
      records = records.filter(r => r.question.toLowerCase().includes(lower));
    }
    records = records.slice(0, limit);

    if (records.length === 0) {
      return query ? `No decisions found matching '${query}'.` : "No decisions recorded yet.";
    }

    const lines = records.map(r => {
      const date = new Date(r.createdAt).toISOString().slice(0, 10);
      const opts = r.optionsConsidered.length > 0
        ? ` (considered: ${r.optionsConsidered.join(", ")})`
        : "";
      return `[${r.id.slice(0, 8)}] ${date} — ${r.question}\n  Chosen: ${r.chosenOption}${opts}\n  Rationale: ${r.rationale}`;
    });

    return `Decision history (${records.length} record${records.length === 1 ? "" : "s"}):\n\n${lines.join("\n\n")}`;
  }
}
