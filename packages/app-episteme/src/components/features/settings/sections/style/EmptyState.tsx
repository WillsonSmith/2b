import { useState } from "react";
import { Button } from "../../../../primitives/Button.tsx";
import { Textarea } from "../../../../primitives/Textarea.tsx";
import { Text } from "../../../../primitives/Text.tsx";

interface StyleEmptyStateProps {
  onCreate: (body: string) => void | Promise<void>;
  onOpenLibrary: () => void;
}

/**
 * Fast path for a workspace with no sections yet: a single textarea that
 * creates one "Default" section on save. Structure is opt-in — users who just
 * want one block never have to think about sections.
 */
export function StyleEmptyState({ onCreate, onOpenLibrary }: StyleEmptyStateProps) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onCreate(content);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ep-style-section__empty">
      <Textarea
        autosize
        maxAutosizeRows={20}
        rows={8}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={"# Style Guide\n\n- Use active voice\n- Prefer short sentences (under 25 words)\n- Avoid jargon unless the audience is technical"}
        spellCheck={false}
        aria-label="Style guide"
      />
      <div className="ep-style-section__empty-actions">
        <Button variant="link" size="sm" onClick={onOpenLibrary}>
          Browse library
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="solid" onClick={handleSave} disabled={saving || !content.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <Text variant="caption" tone="muted">
        Saving creates your first section. Add more to organise voice, tone, and formatting rules separately.
      </Text>
    </div>
  );
}
