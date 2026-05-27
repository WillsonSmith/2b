import { SCOPES, SCOPE_LABELS } from "./constants.ts";
import type { Scope } from "./types.ts";

interface ScopeTabsProps {
  active: Scope;
  onChange: (scope: Scope) => void;
}

export function ScopeTabs({ active, onChange }: ScopeTabsProps) {
  return (
    <div className="usearch-scopes" role="tablist">
      {SCOPES.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={active === s}
          className={`usearch-scope-tab${active === s ? " active" : ""}`}
          onClick={() => onChange(s)}
        >
          {SCOPE_LABELS[s]}
        </button>
      ))}
      <span className="usearch-scope-hint">Tab to cycle</span>
    </div>
  );
}
