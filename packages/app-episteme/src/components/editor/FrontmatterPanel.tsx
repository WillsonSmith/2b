import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "../primitives/Button.tsx";
import { Chip } from "../primitives/Chip.tsx";
import { Icon } from "../primitives/Icon.tsx";
import { IconButton } from "../primitives/IconButton.tsx";
import { Input } from "../primitives/Input.tsx";
import { Textarea } from "../primitives/Textarea.tsx";
import {
  parseYamlFields,
  serializeYamlFields,
  isStructuredYaml,
  type FrontmatterFields,
  type FrontmatterValue,
} from "../../features/frontmatter.ts";

interface FrontmatterPanelProps {
  yaml: string | null;
  onChange: (yaml: string | null) => void;
}

function renameKey(
  obj: FrontmatterFields,
  oldKey: string,
  newKey: string,
): FrontmatterFields {
  const out: FrontmatterFields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === oldKey) out[newKey] = v;
    else out[k] = v;
  }
  return out;
}

export function FrontmatterPanel({ yaml, onChange }: FrontmatterPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [forceRaw, setForceRaw] = useState(false);

  const fields = useMemo(() => parseYamlFields(yaml ?? ""), [yaml]);
  const fieldEntries = Object.entries(fields);
  const hasYaml = yaml != null && yaml.trim().length > 0;
  const yamlIsStructured = yaml == null || isStructuredYaml(yaml);
  const showRaw = forceRaw || !yamlIsStructured;

  const commit = (next: FrontmatterFields) => {
    const yamlStr = serializeYamlFields(next);
    onChange(yamlStr.length === 0 ? null : yamlStr);
  };

  if (!hasYaml && fieldEntries.length === 0) {
    return (
      <div className="frontmatter-panel frontmatter-panel-empty">
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Icon icon={Plus} size="xs" />}
          onClick={() => commit({ title: "" })}
        >
          Add properties
        </Button>
      </div>
    );
  }

  return (
    <div className="frontmatter-panel">
      <div className="fm-header">
        <button
          type="button"
          className="fm-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon icon={expanded ? ChevronDown : ChevronRight} size="sm" />
          <span>Properties</span>
          <span className="fm-count">{fieldEntries.length}</span>
        </button>
        {expanded && (
          <div className="fm-header-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setForceRaw((v) => !v)}
              disabled={!yamlIsStructured}
              title={showRaw ? "Show fields" : "Edit as YAML"}
            >
              {showRaw ? "Fields" : "YAML"}
            </Button>
            {!showRaw && (
              <IconButton
                size="sm"
                icon={<Icon icon={Plus} size="sm" />}
                aria-label="Add property"
                onClick={() => {
                  let key = "new_key";
                  let n = 1;
                  while (key in fields) key = `new_key_${++n}`;
                  commit({ ...fields, [key]: "" });
                }}
              />
            )}
          </div>
        )}
      </div>

      {expanded && showRaw && (
        <Textarea
          className="fm-raw"
          value={yaml ?? ""}
          onChange={(e) =>
            onChange(e.target.value.length === 0 ? null : e.target.value)
          }
          spellCheck={false}
          rows={Math.max(3, (yaml ?? "").split("\n").length)}
        />
      )}

      {expanded && !showRaw && (
        <div className="fm-fields">
          {fieldEntries.map(([key, value], idx) => (
            <FieldRow
              key={idx}
              fieldKey={key}
              value={value}
              onKeyChange={(newKey) => commit(renameKey(fields, key, newKey))}
              onValueChange={(newValue) =>
                commit({ ...fields, [key]: newValue })
              }
              onDelete={() => {
                const next = { ...fields };
                delete next[key];
                commit(next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FieldRowProps {
  fieldKey: string;
  value: FrontmatterValue;
  onKeyChange: (k: string) => void;
  onValueChange: (v: FrontmatterValue) => void;
  onDelete: () => void;
}

function FieldRow({
  fieldKey,
  value,
  onKeyChange,
  onValueChange,
  onDelete,
}: FieldRowProps) {
  return (
    <div className="fm-row">
      <Input
        className="fm-key"
        size="sm"
        value={fieldKey}
        onChange={(e) => onKeyChange(e.target.value)}
        spellCheck={false}
      />
      <div className="fm-value">
        <ValueEditor fieldKey={fieldKey} value={value} onChange={onValueChange} />
      </div>
      <IconButton
        size="sm"
        icon={<Icon icon={Trash2} size="sm" />}
        aria-label={`Remove ${fieldKey}`}
        onClick={onDelete}
      />
    </div>
  );
}

interface ValueEditorProps {
  fieldKey: string;
  value: FrontmatterValue;
  onChange: (v: FrontmatterValue) => void;
}

function ValueEditor({ fieldKey, value, onChange }: ValueEditorProps) {
  if (Array.isArray(value)) {
    return <ChipEditor values={value} onChange={onChange} />;
  }

  const stringValue = value == null ? "" : String(value);

  if (fieldKey === "summary") {
    return (
      <Textarea
        className="fm-textarea"
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
      />
    );
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return (
      <Input
        type="date"
        size="sm"
        className="fm-input"
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <Input
      size="sm"
      className="fm-input"
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface ChipEditorProps {
  values: string[];
  onChange: (v: string[]) => void;
}

function ChipEditor({ values, onChange }: ChipEditorProps) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...values, trimmed]);
    setDraft("");
  };
  return (
    <div className="fm-chips">
      {values.map((v, i) => (
        <Chip key={i} onRemove={() => onChange(values.filter((_, j) => j !== i))}>
          {v}
        </Chip>
      ))}
      <input
        type="text"
        className="fm-chip-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={values.length === 0 ? "Add tag..." : ""}
      />
    </div>
  );
}
