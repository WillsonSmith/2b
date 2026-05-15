/**
 * PlanPlugin — structured multi-step planning with SQLite persistence.
 *
 * Gives the agent explicit plan management tools and automatically injects the
 * active plan as a markdown table into every turn's context so the LLM always
 * knows current progress — surviving MemoryPlugin's summarization cycle.
 *
 * Tools:
 *   create_plan    — define a goal and its ordered steps; abandons any prior active plan
 *   update_step    — advance a step to in_progress / done / skipped / failed, with optional notes and structured data
 *   complete_plan  — mark the active plan completed
 *   abandon_plan   — mark the active plan abandoned
 *   get_plan       — retrieve full details of the active (or a named) plan, including step data payloads
 *
 * Schema version 2 adds the `data` column to plan_steps.
 */
import { randomUUID } from "crypto";
import { join } from "node:path";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { Plan, PlanStep, PlanStatus, PlanStepStatus } from "../core/types.ts";
import { appDataPath } from "../paths.ts";
import { logger } from "../logger.ts";
import { getPlatform } from "../platform/platform.ts";
import type { IDatabase } from "../platform/IDatabase.ts";

const STEP_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "done", "skipped", "failed"]);
const SCHEMA_VERSION = 2;

export class PlanPlugin implements AgentPlugin {
  name = "Plan";
  private db: IDatabase;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(appDataPath("data"), "plans.sqlite");
    this.db = getPlatform().openDatabase(path);
    this.initSchema();
  }

  private initSchema(): void {
    // Version tracking table
    this.db.exec(`CREATE TABLE IF NOT EXISTS plan_schema_version (version INTEGER NOT NULL)`);
    const versionRow = this.db.query(`SELECT version FROM plan_schema_version LIMIT 1`).get() as
      | { version: number }
      | undefined;
    const currentVersion = versionRow?.version ?? 0;

    // v0 → base tables (always idempotent)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id         TEXT PRIMARY KEY,
        goal       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plan_steps (
        id          TEXT PRIMARY KEY,
        plan_id     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        description TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        notes       TEXT
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_id ON plan_steps(plan_id)`);

    // v1 → v2: add data column for structured step output
    if (currentVersion < 2) {
      const cols = this.db.query(`PRAGMA table_info(plan_steps)`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "data")) {
        this.db.exec(`ALTER TABLE plan_steps ADD COLUMN data TEXT`);
      }
      if (currentVersion === 0) {
        this.db.exec(`INSERT INTO plan_schema_version (version) VALUES (${SCHEMA_VERSION})`);
      } else {
        this.db.exec(`UPDATE plan_schema_version SET version = ${SCHEMA_VERSION}`);
      }
    }
  }

  // ── Public read API ────────────────────────────────────────────────────────

  public getActivePlan(): Plan | null {
    const row = this.db
      .query(`SELECT * FROM plans WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`)
      .get() as { id: string; goal: string; status: string; created_at: number; updated_at: number } | undefined;
    if (!row) return null;
    return this.hydratePlan(row);
  }

  public getPlanById(id: string): Plan | null {
    const row = this.db.query(`SELECT * FROM plans WHERE id = ?`).get(id) as
      | { id: string; goal: string; status: string; created_at: number; updated_at: number }
      | undefined;
    if (!row) return null;
    return this.hydratePlan(row);
  }

  public listRecentPlans(limit = 20): Array<Omit<Plan, "steps">> {
    return (
      this.db
        .query(`SELECT id, goal, status, created_at, updated_at FROM plans ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(limit) as Array<{ id: string; goal: string; status: string; created_at: number; updated_at: number }>
    ).map((row) => ({
      id: row.id,
      goal: row.goal,
      status: row.status as PlanStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private hydratePlan(row: {
    id: string;
    goal: string;
    status: string;
    created_at: number;
    updated_at: number;
  }): Plan {
    const steps = (
      this.db
        .query(`SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY position`)
        .all(row.id) as Array<{
        id: string;
        plan_id: string;
        position: number;
        description: string;
        status: string;
        notes: string | null;
        data: string | null;
      }>
    ).map(
      (s): PlanStep => ({
        id: s.id,
        planId: s.plan_id,
        position: s.position,
        description: s.description,
        status: s.status as PlanStepStatus,
        notes: s.notes,
        data: s.data ?? null,
      }),
    );

    return {
      id: row.id,
      goal: row.goal,
      status: row.status as PlanStatus,
      steps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private touchPlan(id: string): void {
    this.db.exec(`UPDATE plans SET updated_at = ? WHERE id = ?`, [Date.now(), id]);
  }

  private formatPlan(plan: Plan): string {
    const rows = plan.steps.map((s, i) => {
      const desc = s.description.length > 80 ? s.description.slice(0, 79) + "…" : s.description;
      const notes = s.notes ?? "";
      return `| ${i + 1} | ${desc} | ${s.status} | ${notes} |`;
    });
    return [
      `**Plan:** ${plan.goal}  (ID: ${plan.id.slice(0, 8)})`,
      "",
      "| # | Step | Status | Notes |",
      "|---|------|--------|-------|",
      ...rows,
    ].join("\n");
  }

  // ── Plugin hooks ───────────────────────────────────────────────────────────

  getSystemPromptFragment(): string {
    return [
      "## Planning",
      "You have a structured plan system. Use it for any multi-step goal (3+ ordered steps).",
      "  create_plan   — define a goal and ordered steps; replaces any active plan",
      "  update_step   — mark a step in_progress / done / skipped / failed; store human-readable outcome in `notes` and structured JSON output in `data` for downstream steps",
      "  complete_plan — mark the current plan completed when all steps are done",
      "  abandon_plan  — cancel the current plan",
      "  get_plan      — inspect the full plan including step data payloads",
      "Always call update_step to advance step status as you work. Store step outputs in `data` as JSON; read prior step data via get_plan, then parse the field. The current plan is shown as a table in context every turn.",
    ].join("\n");
  }

  async getContext(): Promise<string> {
    const plan = this.getActivePlan();
    if (!plan) return "";
    return `Active plan:\n${this.formatPlan(plan)}`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "create_plan",
        description:
          "Create a structured plan with a goal and ordered steps. Any existing active plan is abandoned first.",
        parameters: {
          type: "object",
          properties: {
            goal: { type: "string", description: "The overall goal of the plan." },
            steps: {
              type: "array",
              items: { type: "string" },
              description: "Ordered list of step descriptions.",
            },
          },
          required: ["goal", "steps"],
        },
      },
      {
        name: "update_step",
        description:
          "Update the status of a plan step. Valid statuses: pending, in_progress, done, skipped, failed.",
        parameters: {
          type: "object",
          properties: {
            step_id: {
              type: "string",
              description: "The step ID (first 8 chars of the UUID are sufficient).",
            },
            status: {
              type: "string",
              description: "New status: pending | in_progress | done | skipped | failed",
            },
            notes: {
              type: "string",
              description: "Optional human-readable notes explaining the outcome or progress.",
            },
            data: {
              type: "string",
              description:
                "Optional JSON string storing structured step output for downstream steps to consume. Use get_plan to read prior step data.",
            },
          },
          required: ["step_id", "status"],
        },
      },
      {
        name: "complete_plan",
        description: "Mark the active plan as completed.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "abandon_plan",
        description: "Mark the active plan as abandoned.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Optional reason for abandoning." },
          },
        },
      },
      {
        name: "get_plan",
        description:
          "Get full details of the active plan (or a specific plan by ID), including step data payloads.",
        parameters: {
          type: "object",
          properties: {
            plan_id: {
              type: "string",
              description: "Optional plan ID. Omit to get the active plan.",
            },
          },
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "create_plan":
        return this.handleCreatePlan(args);
      case "update_step":
        return this.handleUpdateStep(args);
      case "complete_plan":
        return this.handleSetPlanStatus("completed");
      case "abandon_plan":
        return this.handleSetPlanStatus("abandoned", args.reason as string | undefined);
      case "get_plan":
        return this.handleGetPlan(args);
      default:
        return undefined;
    }
  }

  // ── Tool handlers ──────────────────────────────────────────────────────────

  private handleCreatePlan(args: Record<string, unknown>): string {
    const goal = String(args.goal ?? "").trim();
    if (!goal) return "create_plan error: goal is required.";

    const rawSteps = args.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return "create_plan error: steps must be a non-empty array of strings.";
    }
    const stepDescriptions = rawSteps.map(String).filter((s) => s.trim().length > 0);
    if (stepDescriptions.length === 0) {
      return "create_plan error: all steps were empty strings.";
    }

    const now = Date.now();

    const existing = this.getActivePlan();
    if (existing) {
      this.db.exec(`UPDATE plans SET status = 'abandoned', updated_at = ? WHERE id = ?`, [now, existing.id]);
      logger.info(this.name, `create_plan: abandoned prior plan ${existing.id.slice(0, 8)}`);
    }

    const planId = randomUUID();
    this.db.exec(`INSERT INTO plans (id, goal, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`, [
      planId,
      goal,
      now,
      now,
    ]);

    for (let i = 0; i < stepDescriptions.length; i++) {
      this.db.exec(
        `INSERT INTO plan_steps (id, plan_id, position, description, status) VALUES (?, ?, ?, ?, 'pending')`,
        [randomUUID(), planId, i, stepDescriptions[i]],
      );
    }

    logger.info(this.name, `create_plan: created plan ${planId.slice(0, 8)} with ${stepDescriptions.length} steps`);
    const plan = this.getPlanById(planId)!;
    return `Plan created.\n${this.formatPlan(plan)}`;
  }

  private handleUpdateStep(args: Record<string, unknown>): string {
    const stepIdPrefix = String(args.step_id ?? "").trim();
    const status = String(args.status ?? "").trim() as PlanStepStatus;
    const notes = typeof args.notes === "string" ? args.notes.trim() : null;
    const data = typeof args.data === "string" ? args.data.trim() : null;

    if (!stepIdPrefix) return "update_step error: step_id is required.";
    if (!STEP_STATUSES.has(status)) {
      return `update_step error: invalid status '${status}'. Valid values: ${[...STEP_STATUSES].join(", ")}.`;
    }

    const row = this.db
      .query(`SELECT id, plan_id FROM plan_steps WHERE id = ? OR id LIKE ? LIMIT 1`)
      .get(stepIdPrefix, `${stepIdPrefix}%`) as { id: string; plan_id: string } | undefined;

    if (!row) return `update_step error: no step found matching '${stepIdPrefix}'.`;

    this.db.exec(
      `UPDATE plan_steps SET status = ?, notes = COALESCE(?, notes), data = COALESCE(?, data) WHERE id = ?`,
      [status, notes, data, row.id],
    );
    this.touchPlan(row.plan_id);

    logger.debug(this.name, `update_step: step ${row.id.slice(0, 8)} → ${status}`);
    return `Step ${row.id.slice(0, 8)} updated to '${status}'.${notes ? ` Notes: ${notes}` : ""}`;
  }

  private handleSetPlanStatus(status: "completed" | "abandoned", reason?: string): string {
    const plan = this.getActivePlan();
    if (!plan) return `No active plan to ${status === "completed" ? "complete" : "abandon"}.`;

    this.db.exec(`UPDATE plans SET status = ?, updated_at = ? WHERE id = ?`, [status, Date.now(), plan.id]);
    logger.info(this.name, `plan ${plan.id.slice(0, 8)} → ${status}${reason ? `: ${reason}` : ""}`);
    const suffix = reason ? ` Reason: ${reason}` : "";
    return `Plan '${plan.goal}' marked as ${status}.${suffix}`;
  }

  private handleGetPlan(args: Record<string, unknown>): string {
    const planId = typeof args.plan_id === "string" ? args.plan_id.trim() : null;
    const plan = planId ? this.getPlanById(planId) : this.getActivePlan();
    if (!plan) return planId ? `No plan found with ID '${planId}'.` : "No active plan.";

    const lines = [this.formatPlan(plan)];
    const stepsWithData = plan.steps.filter((s) => s.data);
    if (stepsWithData.length > 0) {
      lines.push("", "**Step data payloads:**");
      for (const s of stepsWithData) {
        lines.push(`- Step ${s.position + 1} [${s.id.slice(0, 8)}]: ${s.data}`);
      }
    }
    return lines.join("\n");
  }
}
