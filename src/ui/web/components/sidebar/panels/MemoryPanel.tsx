import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryRow } from "../../../types.ts";

export function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (type: string, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (type !== "all") params.set("type", type);
      if (q.trim()) params.set("search", q.trim());
      const res = await fetch(`/api/memories?${params}`);
      const data = (await res.json()) as MemoryRow[];
      setMemories(data);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(typeFilter, search);
  }, [typeFilter, load]);

  const handleSearch = useCallback(
    (q: string) => {
      setSearch(q);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => load(typeFilter, q), 400);
    },
    [typeFilter, load],
  );

  const handleEdit = useCallback(
    async (id: string) => {
      if (!editText.trim()) return;
      await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText }),
      });
      setEditingId(null);
      load(typeFilter, search);
    },
    [editText, typeFilter, search, load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this memory?")) return;
      await fetch(`/api/memories/${id}`, { method: "DELETE" });
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (expandedId === id) setExpandedId(null);
    },
    [expandedId],
  );

  return (
    <div className="panel">
      <div className="panel-controls">
        <select
          className="panel-select"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
          }}
        >
          <option value="all">All types</option>
          <option value="factual">Factual</option>
          <option value="behavior">Behavior</option>
          <option value="procedure">Procedure</option>
          <option value="thought">Thought</option>
        </select>
        <input
          className="panel-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <button
          className="panel-btn"
          onClick={() => load(typeFilter, search)}
        >
          ↺
        </button>
      </div>

      {loading && <div className="panel-loading">Loading…</div>}

      <div className="panel-list">
        {memories.map((m) => (
          <div key={m.id} className="memory-item">
            <div
              className="memory-header"
              onClick={() =>
                setExpandedId(expandedId === m.id ? null : m.id)
              }
            >
              <span className="memory-type">{m.type}</span>
              <span className="memory-id">[{m.id.slice(0, 8)}]</span>
              <span className="memory-date">
                {new Date(m.timestamp).toLocaleDateString()}
              </span>
              {m.type === "behavior" && (
                <span className="memory-weight">
                  w:{m.weight?.toFixed(1) ?? "?"}
                </span>
              )}
            </div>
            {expandedId === m.id && (
              <div className="memory-body">
                {editingId === m.id ? (
                  <>
                    <textarea
                      className="memory-edit-area"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={4}
                    />
                    <div className="memory-actions">
                      <button
                        className="panel-btn panel-btn--green"
                        onClick={() => handleEdit(m.id)}
                      >
                        Save
                      </button>
                      <button
                        className="panel-btn"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="memory-text">{m.text}</div>
                    {m.tags.length > 0 && (
                      <div className="memory-tags">
                        {m.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="memory-actions">
                      <button
                        className="panel-btn"
                        onClick={() => {
                          setEditingId(m.id);
                          setEditText(m.text);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="panel-btn panel-btn--red"
                        onClick={() => handleDelete(m.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && memories.length === 0 && (
          <div className="panel-empty">No memories found.</div>
        )}
      </div>
    </div>
  );
}
