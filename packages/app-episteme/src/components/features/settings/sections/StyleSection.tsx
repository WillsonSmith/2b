import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../primitives/Button.tsx";
import { Textarea } from "../../../primitives/Textarea.tsx";
import { Text } from "../../../primitives/Text.tsx";
import type { SaveStatus } from "../types.ts";

export function StyleSection() {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    fetch("/api/style-guide")
      .then((r) => r.json())
      .then((data: { content?: string }) => setContent(data.content ?? ""))
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/style-guide", { method: "PATCH", body: content });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }, [content]);

  const handleClear = useCallback(async () => {
    setContent("");
    setStatus("saving");
    try {
      const res = await fetch("/api/style-guide", { method: "PATCH", body: "" });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }, []);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Style guide</h2>
      <p className="modal-desc">
        Write style rules in Markdown. Episteme injects them into every editing and generation prompt.
      </p>
      <Textarea
        className="modal-textarea"
        value={content}
        onChange={(e) => { setContent(e.target.value); setStatus("idle"); }}
        placeholder={"# Style Guide\n\n- Use active voice\n- Prefer short sentences (under 25 words)\n- Avoid jargon unless the audience is technical"}
        spellCheck={false}
      />
      <div className="modal-footer">
        <Button variant="ghost" onClick={handleClear} disabled={status === "saving"}>
          Clear
        </Button>
        <div style={{ flex: 1 }} />
        {status === "saved" && <Text tone="success" variant="caption">Saved</Text>}
        {status === "error" && <Text tone="danger" variant="caption">Save failed</Text>}
        <Button variant="solid" onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
