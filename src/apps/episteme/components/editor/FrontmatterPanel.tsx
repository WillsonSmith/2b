import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
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
        <button
          type="button"
          className="fm-add-empty"
          onClick={() => commit({ title: "" })}
        >
          <Plus size={12} /> Add properties
        </button>
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
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Properties</span>
          <span className="fm-count">{fieldEntries.length}</span>
        </button>
        {expanded && (
          <div className="fm-header-actions">
            <button
              type="button"
              className="fm-mode-toggle"
              onClick={() => setForceRaw((v) => !v)}
              disabled={!yamlIsStructured}
              title={showRaw ? "Show fields" : "Edit as YAML"}
            >
              {showRaw ? "Fields" : "YAML"}
            </button>
            {!showRaw && (
              <button
                type="button"
                className="fm-add"
                onClick={() => {
                  let key = "new_key";
                  let n = 1;
                  while (key in fields) key = `new_key_${++n}`;
                  commit({ ...fields, [key]: "" });
                }}
                title="Add property"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && showRaw && (
        <textarea
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
      <input
        className="fm-key"
        value={fieldKey}
        onChange={(e) => onKeyChange(e.target.value)}
        spellCheck={false}
      />
      <div className="fm-value">
        <ValueEditor fieldKey={fieldKey} value={value} onChange={onValueChange} />
      </div>
      <button
        type="button"
        className="fm-delete"
        onClick={onDelete}
        title="Remove"
      >
        <Trash2 size={13} />
      </button>
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
      <textarea
        className="fm-textarea"
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
      />
    );
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return (
      <input
        type="date"
        className="fm-input"
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      type="text"
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
        <span key={i} className="fm-chip">
          {v}
          <button
            type="button"
            className="fm-chip-remove"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <X size={10} />
          </button>
        </span>
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
