import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeading } from "../../../../composites/SectionHeading.tsx";
import { StatusPill } from "../../../../composites/StatusPill.tsx";
import { Text } from "../../../../primitives/Text.tsx";
import { SectionList } from "./SectionList.tsx";
import { SectionEditor } from "./SectionEditor.tsx";
import { BudgetMeter } from "./BudgetMeter.tsx";
import { LibraryPicker } from "./LibraryPicker.tsx";
import { GenerateModal } from "./GenerateModal.tsx";
import { StyleEmptyState } from "./EmptyState.tsx";
import { computeBudget } from "./budget.ts";
import type { StyleGuideResponse, StyleSection as Section } from "./types.ts";

const SAVE_DEBOUNCE_MS = 400;

export function StyleSection() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/style-guide");
      const data = (await res.json()) as StyleGuideResponse;
      setSections(data.sections);
      setSelectedId((cur) => cur ?? data.sections[0]?.id ?? null);
    } catch {
      /* leave empty */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Generation needs a running model; gate its entry points on AI being on.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { aiEnabled?: boolean }) => setAiEnabled(d.aiEnabled === true))
      .catch(() => setAiEnabled(false));
  }, []);

  // Flush any pending debounced saves on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); };
  }, []);

  const budget = computeBudget(sections);

  const createSection = useCallback(async (body: string, title = "Default") => {
    try {
      const res = await fetch("/api/style-guide/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as Section;
      setSections((prev) => [...prev, created]);
      setSelectedId(created.id);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, []);

  const persistEdit = useCallback((id: string, patch: { title?: string; body?: string; enabled?: boolean }) => {
    fetch(`/api/style-guide/sections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((res) => { if (!res.ok) throw new Error(); setSaveError(false); })
      .catch(() => setSaveError(true));
  }, []);

  const handleEdit = useCallback((id: string, patch: { title?: string; body?: string }) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      persistEdit(id, patch);
    }, SAVE_DEBOUNCE_MS));
  }, [persistEdit]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    persistEdit(id, { enabled });
  }, [persistEdit]);

  const handleDelete = useCallback(async (id: string) => {
    const prev = sections;
    setSections((cur) => cur.filter((s) => s.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    try {
      const res = await fetch(`/api/style-guide/sections/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setSections(prev); // revert
      setSaveError(true);
    }
  }, [sections]);

  const handleReorder = useCallback(async (orderedIds: string[]) => {
    const prev = sections;
    setSections((cur) => {
      const byId = new Map(cur.map((s) => [s.id, s]));
      return orderedIds
        .map((id, i) => { const s = byId.get(id); return s ? { ...s, order: i } : undefined; })
        .filter((s): s is Section => s !== undefined);
    });
    try {
      const res = await fetch("/api/style-guide/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSections(prev); // revert
      setSaveError(true);
    }
  }, [sections]);

  const handleAdd = useCallback(async () => {
    await createSection("", "New section");
  }, [createSection]);

  const handleImport = useCallback(async (slug: string) => {
    try {
      const res = await fetch(`/api/style-guide/library/${slug}/import`, { method: "POST" });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as Section;
      setSections((prev) => [...prev, created]);
      setSelectedId(created.id);
      setLibraryOpen(false);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, []);

  const selected = sections.find((s) => s.id === selectedId) ?? null;
  const enabledCount = sections.filter((s) => s.enabled && s.body.trim()).length;
  const active = enabledCount > 0;

  return (
    <section className="settings-section">
      <SectionHeading
        trailing={
          <StatusPill tone={active ? "success" : "muted"}>
            {active ? `Active · ${enabledCount} section${enabledCount === 1 ? "" : "s"}` : "Inactive"}
          </StatusPill>
        }
      >
        Style guide
      </SectionHeading>
      <p className="modal-desc">
        Episteme injects enabled sections into every editing and generation prompt, in order.
      </p>

      {loaded && sections.length > 0 && <BudgetMeter budget={budget} />}

      {!loaded ? null : sections.length === 0 ? (
        <StyleEmptyState
          onCreate={(body) => createSection(body)}
          onOpenLibrary={() => setLibraryOpen(true)}
          onOpenGenerate={aiEnabled ? () => setGenerateOpen(true) : undefined}
        />
      ) : (
        <div className="ep-style-section__layout">
          <SectionList
            sections={sections}
            selectedId={selectedId}
            droppedSectionIds={budget.droppedSectionIds}
            onSelect={setSelectedId}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onReorder={handleReorder}
            onAdd={handleAdd}
            onOpenLibrary={() => setLibraryOpen(true)}
            onOpenGenerate={aiEnabled ? () => setGenerateOpen(true) : undefined}
          />
          {selected ? (
            <SectionEditor section={selected} onChange={(patch) => handleEdit(selected.id, patch)} />
          ) : (
            <div className="ep-style-section__editor ep-style-section__editor--empty">
              <Text variant="body" tone="muted">Select a section to edit, or add a new one.</Text>
            </div>
          )}
        </div>
      )}

      {saveError && (
        <Text tone="danger" variant="caption">Save failed — your latest change may not be stored.</Text>
      )}

      <LibraryPicker open={libraryOpen} onClose={() => setLibraryOpen(false)} onImport={handleImport} />
      <GenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onAdd={(title, body) => createSection(body, title)}
      />
    </section>
  );
}
