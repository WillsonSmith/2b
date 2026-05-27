import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../primitives/Button.tsx";
import { Text } from "../../../primitives/Text.tsx";
import type { PermissionMode, SaveStatus, ToolInfo } from "../types.ts";

const PERMISSION_OPTIONS: ReadonlyArray<{ value: PermissionMode; label: string }> = [
  { value: "ask", label: "Ask" },
  { value: "session", label: "Session" },
  { value: "never", label: "Never" },
];

export function PermissionsSection() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [modes, setModes] = useState<Record<string, PermissionMode>>({});
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then((data: { tools?: ToolInfo[] }) => setTools(data.tools ?? []))
      .catch(() => {});
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: { permissions?: Record<string, PermissionMode> }) =>
        setModes(data.permissions ?? {}),
      )
      .catch(() => {});
  }, []);

  const setMode = useCallback((name: string, mode: PermissionMode) => {
    setModes((prev) => ({ ...prev, [name]: mode }));
    setStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: modes }),
      });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }, [modes]);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Permissions</h2>
      <p className="modal-desc">
        Decide which agent actions need your approval. "Ask" prompts every time,
        "Session" remembers your approval until the agent restarts, "Never ask"
        runs silently.
      </p>
      {tools.length === 0 ? (
        <Text tone="dim" variant="caption">No permission-gated tools registered.</Text>
      ) : (
        <div className="permissions-list">
          {tools.map((tool) => {
            const mode: PermissionMode = modes[tool.name] ?? "ask";
            return (
              <div key={tool.name} className="permission-row">
                <div className="permission-row-label">
                  <span className="permission-row-name">{tool.name}</span>
                  <span className="permission-row-desc">{tool.description}</span>
                </div>
                <div
                  className="permission-row-controls"
                  role="radiogroup"
                  aria-label={`Approval mode for ${tool.name}`}
                >
                  {PERMISSION_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`permission-pill${mode === opt.value ? " active" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`perm-${tool.name}`}
                        checked={mode === opt.value}
                        onChange={() => setMode(tool.name, opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="modal-footer">
        <div style={{ flex: 1 }} />
        {status === "saved" && <Text tone="success" variant="caption">Saved</Text>}
        {status === "error" && <Text tone="danger" variant="caption">Save failed</Text>}
        <Button
          variant="solid"
          onClick={handleSave}
          disabled={status === "saving" || tools.length === 0}
        >
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
