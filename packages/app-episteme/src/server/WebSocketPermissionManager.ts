/**
 * WebSocketPermissionManager — surfaces tool-approval requests to the Episteme
 * UI over the WebSocket protocol instead of stdin.
 *
 * Flow per request:
 *   1. agent invokes a tool with permission !== "none"
 *   2. BaseAgent calls requestApproval()
 *   3. requestApproval() consults the static config (ask/session/never), then
 *      the in-memory session cache. If both miss it broadcasts a
 *      `permission_request` over the registered `send` callback and parks the
 *      promise in `pending` keyed by a uuid
 *   4. on `permission_response` the server calls resolve(id, decision); the
 *      parked promise resolves true/false and may add to the session cache
 *
 * File-write tools get extra payload: when the tool name matches the
 * FILE_MUTATING_TOOLS allowlist and args carry a workspace-relative path, the
 * current file content is attached as `fileDiff.currentContent` so the client
 * can render a diff against `fileDiff.proposedContent`.
 */
import { randomUUID } from "node:crypto";
import { resolve as resolvePath, join } from "node:path";
import {
  SessionCache,
  type PermissionManager,
  type PermissionRequest,
} from "@2b/framework/core/PermissionManager.ts";
import type { EpistemePermissionMode } from "../config.ts";
import { logger } from "@2b/framework/logger.ts";

/** Decision shipped from the client. */
export type PermissionDecision = "allow_once" | "allow_session" | "deny";

interface PendingRequest {
  toolName: string;
  resolve: (granted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Payload shape mirrored in protocol.ts — kept in sync by hand. */
export interface FileDiffPayload {
  path: string;
  currentContent: string;
  proposedContent: string;
}

/** Subset of the protocol's permission_request shape. */
export interface PermissionRequestMessage {
  type: "permission_request";
  id: string;
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  fileDiff?: FileDiffPayload;
}

/** Tools whose `args.path` is a workspace-relative file write the user might want to diff. */
const FILE_MUTATING_TOOLS = new Set([
  "write_file",
  "append_file",
  "patch_file",
]);

export class WebSocketPermissionManager implements PermissionManager {
  private readonly cache = new SessionCache();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly modes: Map<string, EpistemePermissionMode>;
  private send: (msg: PermissionRequestMessage) => void;

  constructor(
    private readonly workspaceRoot: string,
    permissions: Record<string, EpistemePermissionMode> | undefined,
    send: (msg: PermissionRequestMessage) => void,
    private readonly timeoutMs = 30_000,
  ) {
    this.send = send;
    this.modes = new Map(Object.entries(permissions ?? {}));
  }

  /**
   * Swap the send callback at runtime. Used when the server reconfigures
   * which socket(s) receive permission prompts (e.g. last-writer-wins for the
   * primary client).
   */
  setSend(send: (msg: PermissionRequestMessage) => void): void {
    this.send = send;
  }

  /**
   * Update the per-tool permission modes (e.g. after the user changed them in
   * settings). Existing pending prompts are unaffected — only future requests
   * see the new modes.
   */
  setModes(permissions: Record<string, EpistemePermissionMode> | undefined): void {
    this.modes.clear();
    for (const [k, v] of Object.entries(permissions ?? {})) this.modes.set(k, v);
  }

  isSessionApproved(toolName: string): boolean {
    const mode = this.modes.get(toolName);
    if (mode === "never") return true;
    return this.cache.has(toolName);
  }

  async requestApproval(req: PermissionRequest): Promise<boolean> {
    const mode = this.modes.get(req.toolName);
    if (mode === "never") return true;
    if (this.cache.has(req.toolName)) return true;
    if (mode === "session") {
      // User pre-authorised this tool for the session — approve and cache so
      // subsequent calls don't roundtrip through requestApproval again.
      this.cache.add(req.toolName);
      return true;
    }

    const id = randomUUID();
    const message: PermissionRequestMessage = {
      type: "permission_request",
      id,
      agentName: req.agentName,
      toolName: req.toolName,
      args: req.args,
    };

    const fileDiff = await this.buildFileDiff(req);
    if (fileDiff) message.fileDiff = fileDiff;

    return new Promise<boolean>((resolveOuter) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        logger.warn(
          "WebSocketPermissionManager",
          `Tool "${req.toolName}" auto-denied after ${this.timeoutMs}ms.`,
        );
        resolveOuter(false);
      }, this.timeoutMs);

      this.pending.set(id, {
        toolName: req.toolName,
        resolve: resolveOuter,
        timer,
      });

      try {
        this.send(message);
      } catch (err) {
        // If we can't even send the prompt there's no point waiting for it.
        clearTimeout(timer);
        this.pending.delete(id);
        logger.warn(
          "WebSocketPermissionManager",
          `Failed to send permission_request for "${req.toolName}": ${(err as Error).message}`,
        );
        resolveOuter(false);
      }
    });
  }

  /**
   * Called by the server message dispatch when a `permission_response` arrives
   * from the client. Unknown ids are ignored (the request may have already
   * timed out).
   */
  resolveDecision(id: string, decision: PermissionDecision): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (decision === "allow_session") this.cache.add(pending.toolName);
    pending.resolve(decision !== "deny");
  }

  /**
   * For file-mutating tools, attach the on-disk content so the UI can diff
   * against the proposed content carried in args. Returns null when the tool
   * isn't a known mutator, when args don't carry a path/content pair we can
   * make sense of, or when the file can't be read (treat as empty current).
   */
  private async buildFileDiff(req: PermissionRequest): Promise<FileDiffPayload | null> {
    if (!FILE_MUTATING_TOOLS.has(req.toolName)) return null;
    const rawPath = req.args.path;
    if (typeof rawPath !== "string" || !rawPath) return null;

    const absolute = rawPath.startsWith("/")
      ? rawPath
      : resolvePath(join(this.workspaceRoot, rawPath));

    let current = "";
    try {
      current = await Bun.file(absolute).text();
    } catch {
      // File may not exist yet (write_file creates) — treat as empty.
    }

    const proposed = computeProposedContent(req.toolName, req.args, current);
    if (proposed === null) return null;

    return { path: rawPath, currentContent: current, proposedContent: proposed };
  }
}

/**
 * Best-effort reconstruction of what the file will look like after the tool
 * runs, computed from the tool args alone. Used purely to show the user a
 * diff in the approval dialog — the actual write is still executed by the
 * plugin.
 *
 * Returns null when we can't sensibly preview (e.g. unknown tool or
 * malformed args). Callers fall back to a no-diff prompt in that case.
 */
function computeProposedContent(
  toolName: string,
  args: Record<string, unknown>,
  current: string,
): string | null {
  if (toolName === "write_file") {
    const c = args.content;
    return typeof c === "string" ? c : null;
  }
  if (toolName === "append_file") {
    const c = args.content;
    return typeof c === "string" ? current + c : null;
  }
  if (toolName === "patch_file") {
    const edits = args.edits;
    if (!Array.isArray(edits)) return null;
    let next = current;
    for (const raw of edits) {
      if (!raw || typeof raw !== "object") return null;
      const edit = raw as { search?: unknown; replace?: unknown };
      if (typeof edit.search !== "string" || typeof edit.replace !== "string") return null;
      // Mirror the plugin's behaviour: bail out on ambiguous/missing matches
      // so we don't show a misleading diff.
      const idx = next.indexOf(edit.search);
      if (idx === -1 || next.indexOf(edit.search, idx + 1) !== -1) return null;
      next = next.slice(0, idx) + edit.replace + next.slice(idx + edit.search.length);
    }
    return next;
  }
  return null;
}
