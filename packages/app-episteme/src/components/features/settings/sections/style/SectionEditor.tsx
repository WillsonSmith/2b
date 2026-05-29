import { Input } from "../../../../primitives/Input.tsx";
import { Textarea } from "../../../../primitives/Textarea.tsx";
import { Text } from "../../../../primitives/Text.tsx";
import type { StyleSection } from "./types.ts";

interface SectionEditorProps {
  section: StyleSection;
  onChange: (patch: { title?: string; body?: string }) => void;
}

export function SectionEditor({ section, onChange }: SectionEditorProps) {
  return (
    <div className="ep-style-section__editor">
      <Input
        value={section.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Section title"
        aria-label="Section title"
      />
      <Textarea
        autosize
        maxAutosizeRows={24}
        rows={8}
        value={section.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder={"- Use active voice\n- Prefer short sentences (under 25 words)\n- Avoid jargon unless the audience is technical"}
        spellCheck={false}
        aria-label="Section body"
      />
      {!section.enabled && (
        <Text variant="caption" tone="muted">
          This section is disabled and won't be sent to the agent.
        </Text>
      )}
    </div>
  );
}
