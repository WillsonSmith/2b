import { useState } from "react";
import type { DragEvent } from "react";
import { GripVertical, Plus, Trash2, LibraryBig, Sparkles } from "lucide-react";
import { Button } from "../../../../primitives/Button.tsx";
import { IconButton } from "../../../../primitives/IconButton.tsx";
import { Checkbox } from "../../../../primitives/Checkbox.tsx";
import { Icon } from "../../../../primitives/Icon.tsx";
import { Text } from "../../../../primitives/Text.tsx";
import type { StyleSection } from "./types.ts";

interface SectionListProps {
  sections: StyleSection[];
  selectedId: string | null;
  droppedSectionIds: string[];
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAdd: () => void;
  onOpenLibrary: () => void;
  /** Opens the AI generation modal; omitted/undefined when AI is disabled. */
  onOpenGenerate?: () => void;
}

export function SectionList({
  sections,
  selectedId,
  droppedSectionIds,
  onSelect,
  onToggle,
  onDelete,
  onReorder,
  onAdd,
  onOpenLibrary,
  onOpenGenerate,
}: SectionListProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = sections.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setDragId(null);
    setOverId(null);
    onReorder(ids);
  };

  return (
    <div className="ep-style-section__list">
      <ul className="ep-style-section__list-items">
        {sections.map((section) => {
          const dropped = droppedSectionIds.includes(section.id);
          const classes = [
            "ep-style-section__row",
            section.id === selectedId && "ep-style-section__row--selected",
            section.id === overId && "ep-style-section__row--dragover",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              key={section.id}
              className={classes}
              draggable
              onDragStart={() => setDragId(section.id)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e: DragEvent) => { e.preventDefault(); setOverId(section.id); }}
              onDragLeave={() => setOverId((cur) => (cur === section.id ? null : cur))}
              onDrop={(e: DragEvent) => { e.preventDefault(); handleDrop(section.id); }}
            >
              <span className="ep-style-section__drag" aria-hidden="true">
                <Icon icon={GripVertical} size="sm" />
              </span>
              <Checkbox
                checked={section.enabled}
                onChange={(checked) => onToggle(section.id, checked)}
              />
              <button
                type="button"
                className="ep-style-section__row-title"
                onClick={() => onSelect(section.id)}
              >
                <Text variant="body" tone={section.enabled ? "default" : "muted"}>
                  {section.title}
                </Text>
                {dropped && (
                  <Text variant="caption" tone="danger">over budget</Text>
                )}
              </button>
              <IconButton
                icon={<Icon icon={Trash2} size="sm" />}
                aria-label={`Delete ${section.title}`}
                variant="ghost"
                size="sm"
                onClick={() => onDelete(section.id)}
                className="ep-style-section__row-delete"
              />
            </li>
          );
        })}
      </ul>
      <div className="ep-style-section__list-actions">
        <Button variant="ghost" size="sm" iconLeft={<Icon icon={Plus} size="sm" />} onClick={onAdd}>
          Add section
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon icon={LibraryBig} size="sm" />}
          onClick={onOpenLibrary}
        >
          Import from library
        </Button>
        {onOpenGenerate && (
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Icon icon={Sparkles} size="sm" />}
            onClick={onOpenGenerate}
          >
            Generate with AI
          </Button>
        )}
      </div>
    </div>
  );
}
