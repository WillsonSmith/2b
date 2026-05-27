import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../primitives/Button.tsx";
import { Text } from "../../../primitives/Text.tsx";
import { ColorSwatchGroup } from "../ColorSwatchGroup.tsx";
import { SettingsRow } from "../SettingsRow.tsx";
import { ToggleSwitch } from "../ToggleSwitch.tsx";
import type { SaveStatus } from "../types.ts";
import type { WritingAidsConfig, WritingAidColors } from "../../../../config.ts";
import { DEFAULT_HIGHLIGHT_COLORS, type HighlightColorKey } from "../../../../features/themedColor.ts";

interface WritingAidsSectionProps {
  onChange?: (aids: WritingAidsConfig) => void;
}

interface AidToggleRowProps {
  name: string;
  desc: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
  indent?: boolean;
  swatchValue?: string;
  swatchCustomized?: boolean;
  onSwatchChange?: (v: string) => void;
  onSwatchReset?: () => void;
}

function AidToggleRow({
  name,
  desc,
  checked,
  onCheck,
  indent,
  swatchValue,
  swatchCustomized,
  onSwatchChange,
  onSwatchReset,
}: AidToggleRowProps) {
  return (
    <SettingsRow
      name={name}
      description={desc}
      indent={indent}
      trailing={
        swatchValue && onSwatchChange ? (
          <ColorSwatchGroup
            value={swatchValue}
            onChange={onSwatchChange}
            onReset={onSwatchReset}
            customized={swatchCustomized}
          />
        ) : undefined
      }
      control={<ToggleSwitch checked={checked} onChange={onCheck} ariaLabel={name} />}
    />
  );
}

export function WritingAidsSection({ onChange }: WritingAidsSectionProps) {
  const [aids, setAids] = useState<WritingAidsConfig>({});
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: { features?: { writingAids?: WritingAidsConfig } }) => {
        setAids(data.features?.writingAids ?? {});
      })
      .catch(() => {});
  }, []);

  const update = useCallback((patch: Partial<WritingAidsConfig>) => {
    setAids((prev) => ({ ...prev, ...patch }));
    setStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { writingAids: aids } }),
      });
      if (res.ok) {
        onChange?.(aids);
        setStatus("saved");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }, [aids, onChange]);

  const setColor = useCallback((key: HighlightColorKey, value: string) => {
    setAids((prev) => ({
      ...prev,
      colors: { ...(prev.colors ?? {}), [key]: value },
    }));
    setStatus("idle");
  }, []);
  const clearColor = useCallback((key: HighlightColorKey) => {
    setAids((prev) => {
      const nextColors: WritingAidColors = { ...(prev.colors ?? {}) };
      delete nextColors[key];
      return { ...prev, colors: nextColors };
    });
    setStatus("idle");
  }, []);

  const swatchProps = (key: HighlightColorKey) => ({
    swatchValue: aids.colors?.[key] ?? DEFAULT_HIGHLIGHT_COLORS[key],
    swatchCustomized: aids.colors?.[key] != null,
    onSwatchChange: (v: string) => setColor(key, v),
    onSwatchReset: () => clearColor(key),
  });

  const posOn = aids.posHighlight ?? false;
  const focusOn = aids.focusMode ?? false;
  const styleOn = aids.styleCheck ?? false;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Writing aids</h2>
      <p className="modal-desc">iA Writer-style visual layers. All run locally — no AI calls.</p>

      <h3 className="settings-subhead">Syntax highlighting</h3>
      <AidToggleRow
        name="Parts of speech"
        desc="Color nouns, verbs, adjectives, and adverbs."
        checked={posOn}
        onCheck={(v) => update({ posHighlight: v })}
      />
      {posOn && (
        <>
          <AidToggleRow name="Nouns" desc="" checked={aids.posNoun ?? true}
            onCheck={(v) => update({ posNoun: v })} indent {...swatchProps("posNoun")} />
          <AidToggleRow name="Verbs" desc="" checked={aids.posVerb ?? true}
            onCheck={(v) => update({ posVerb: v })} indent {...swatchProps("posVerb")} />
          <AidToggleRow name="Adjectives" desc="" checked={aids.posAdjective ?? true}
            onCheck={(v) => update({ posAdjective: v })} indent {...swatchProps("posAdjective")} />
          <AidToggleRow name="Adverbs" desc="" checked={aids.posAdverb ?? true}
            onCheck={(v) => update({ posAdverb: v })} indent {...swatchProps("posAdverb")} />
        </>
      )}
      <AidToggleRow
        name="Punctuation"
        desc="Tint commas, periods, dashes, and quotes."
        checked={aids.punctuationHighlight ?? false}
        onCheck={(v) => update({ punctuationHighlight: v })}
        {...swatchProps("punct")}
      />

      <h3 className="settings-subhead">Focus mode</h3>
      <AidToggleRow
        name="Dim inactive text"
        desc="Fade everything outside the active sentence or paragraph."
        checked={focusOn}
        onCheck={(v) => update({ focusMode: v })}
      />
      {focusOn && (
        <SettingsRow
          name="Focus level"
          description="Keep just the sentence or the whole paragraph visible."
          indent
          control={
            <div className="permission-row-controls" role="radiogroup" aria-label="Focus level">
              {(["sentence", "paragraph"] as const).map((opt) => (
                <label key={opt} className={`permission-pill${(aids.focusLevel ?? "sentence") === opt ? " active" : ""}`}>
                  <input
                    type="radio"
                    name="focus-level"
                    checked={(aids.focusLevel ?? "sentence") === opt}
                    onChange={() => update({ focusLevel: opt })}
                  />
                  <span>{opt === "sentence" ? "Sentence" : "Paragraph"}</span>
                </label>
              ))}
            </div>
          }
        />
      )}

      <h3 className="settings-subhead">Style checks</h3>
      <AidToggleRow
        name="Mark style issues"
        desc="Underline fillers, clichés, and redundancies as you type."
        checked={styleOn}
        onCheck={(v) => update({ styleCheck: v })}
      />
      {styleOn && (
        <>
          <AidToggleRow name="Fillers" desc='Words like "very", "just", "really".'
            checked={aids.styleFiller ?? true}
            onCheck={(v) => update({ styleFiller: v })} indent {...swatchProps("styleFiller")} />
          <AidToggleRow name="Clichés" desc='Phrases like "at the end of the day".'
            checked={aids.styleCliche ?? true}
            onCheck={(v) => update({ styleCliche: v })} indent {...swatchProps("styleCliche")} />
          <AidToggleRow name="Redundancies" desc='Pairs like "ATM machine", "free gift".'
            checked={aids.styleRedundancy ?? true}
            onCheck={(v) => update({ styleRedundancy: v })} indent {...swatchProps("styleRedundancy")} />
          <AidToggleRow name="Strikethrough" desc="Cross out matches instead of underlining them."
            checked={aids.styleStrikethrough ?? false}
            onCheck={(v) => update({ styleStrikethrough: v })} indent />
          <AidToggleRow name="Tint text" desc="Recolor the matched word itself, not just the line."
            checked={aids.styleTintText ?? false}
            onCheck={(v) => update({ styleTintText: v })} indent />
        </>
      )}

      <div className="modal-footer">
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
