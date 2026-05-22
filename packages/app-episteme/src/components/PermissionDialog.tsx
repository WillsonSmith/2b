/**
 * PermissionDialog — modal that surfaces the agent's tool-approval prompts.
 *
 * Subscribes to `permission_request` server messages. When one arrives it
 * displays the agent name, tool name, pretty-printed args, and (for
 * file-mutating tools) a unified line-by-line diff between current and
 * proposed file content. The user picks Allow once / Allow this session /
 * Deny; the choice is sent back as `permission_response` and the dialog
 * dismisses. A request that hasn't been responded to within the same 30 s the
 * server uses auto-resolves to "deny" client-side as well, so the UI never
 * gets stuck on a stale prompt.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Subscribe } from "../hooks/useWebSocket.ts";

type Decision = "allow_once" | "allow_session" | "deny";

interface PendingPrompt {
  id: string;
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  fileDiff?: { path: string; currentContent: string; proposedContent: string };
}

interface PermissionDialogProps {
  wsRef: React.MutableRefObject<WebSocket | null>;
  subscribe: Subscribe;
}

const CLIENT_TIMEOUT_MS = 30_000;
const MAX_ARG_VALUE_PREVIEW = 4_000;

export function PermissionDialog({ wsRef, subscribe }: PermissionDialogProps) {
  // FIFO queue: if several prompts pile up (rare — the agent usually awaits
  // each one) the user can decide them one at a time.
  const [queue, setQueue] = useState<PendingPrompt[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    return subscribe("permission_request", (msg) => {
      setQueue((prev) => [
        ...prev,
        {
          id: msg.id,
          agentName: msg.agentName,
          toolName: msg.toolName,
          args: msg.args,
          fileDiff: msg.fileDiff,
        },
      ]);
    });
  }, [subscribe]);

  const respond = useCallback(
    (id: string, decision: Decision) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "permission_response", id, decision }));
      }
      setQueue((prev) => prev.filter((p) => p.id !== id));
    },
    [wsRef],
  );

  // Client-side auto-deny keeps the UI honest if the server-side timeout fired
  // first (or if the socket dropped after we got the request). Doesn't replace
  // the server timeout — it just stops the modal lingering forever.
  useEffect(() => {
    if (!current) return;
    const id = current.id;
    const t = setTimeout(() => respond(id, "deny"), CLIENT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [current, respond]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        respond(current.id, "deny");
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        respond(current.id, "allow_once");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, respond]);

  if (!current) return null;

  return (
    <div className="permission-dialog-overlay" role="dialog" aria-modal="true">
      <div className="permission-dialog">
        <header className="permission-dialog-header">
          <h2>
            <span className="permission-dialog-agent">{current.agentName}</span> wants to use{" "}
            <code>{current.toolName}</code>
          </h2>
        </header>

        {current.fileDiff ? (
          <DiffBody
            path={current.fileDiff.path}
            currentContent={current.fileDiff.currentContent}
            proposedContent={current.fileDiff.proposedContent}
          />
        ) : (
          <ArgsBody args={current.args} />
        )}

        <footer className="permission-dialog-footer">
          <button
            className="modal-btn-ghost"
            onClick={() => respond(current.id, "deny")}
            autoFocus
          >
            Deny
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="modal-btn-ghost"
            onClick={() => respond(current.id, "allow_session")}
          >
            Allow this session
          </button>
          <button
            className="modal-btn-primary"
            onClick={() => respond(current.id, "allow_once")}
          >
            Allow once
          </button>
        </footer>
      </div>
    </div>
  );
}

function ArgsBody({ args }: { args: Record<string, unknown> }) {
  const pretty = useMemo(() => {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string" && v.length > MAX_ARG_VALUE_PREVIEW) {
        sanitized[k] = `${v.slice(0, MAX_ARG_VALUE_PREVIEW)}… [${v.length - MAX_ARG_VALUE_PREVIEW} chars truncated]`;
      } else {
        sanitized[k] = v;
      }
    }
    return JSON.stringify(sanitized, null, 2);
  }, [args]);
  return (
    <div className="permission-dialog-body">
      <h3 className="permission-dialog-subheading">Arguments</h3>
      <pre className="permission-dialog-args">{pretty}</pre>
    </div>
  );
}

function DiffBody({
  path,
  currentContent,
  proposedContent,
}: {
  path: string;
  currentContent: string;
  proposedContent: string;
}) {
  const rows = useMemo(() => diffLines(currentContent, proposedContent), [currentContent, proposedContent]);
  return (
    <div className="permission-dialog-body">
      <h3 className="permission-dialog-subheading">
        Edit to <code>{path}</code>
      </h3>
      <div className="permission-dialog-diff">
        {rows.map((row, idx) => (
          <div key={idx} className={`diff-row diff-row--${row.kind}`}>
            <span className="diff-row-marker">
              {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
            </span>
            <span className="diff-row-text">{row.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type DiffRow = { kind: "add" | "remove" | "context"; text: string };

/**
 * Minimal LCS-based line diff. Good enough for previewing a small edit —
 * we're not trying to compete with `diff` package quality, just give the user
 * enough signal to decide whether to approve.
 *
 * Caps the diff at 1000 lines per side so a huge write_file doesn't lock the
 * UI thread. When capped we degrade to a "current ⇒ proposed" stacked view
 * (everything in `current` shown as removed, everything in `proposed` shown
 * as added) which is still useful for an approve/deny call.
 */
function diffLines(a: string, b: string): DiffRow[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const CAP = 1000;
  if (aLines.length > CAP || bLines.length > CAP) {
    return [
      ...aLines.slice(0, CAP).map((text): DiffRow => ({ kind: "remove", text })),
      ...bLines.slice(0, CAP).map((text): DiffRow => ({ kind: "add", text })),
    ];
  }
  // Compute LCS table.
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      rows.push({ kind: "context", text: aLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ kind: "remove", text: aLines[i]! });
      i++;
    } else {
      rows.push({ kind: "add", text: bLines[j]! });
      j++;
    }
  }
  while (i < n) rows.push({ kind: "remove", text: aLines[i++]! });
  while (j < m) rows.push({ kind: "add", text: bLines[j++]! });
  return rows;
}
