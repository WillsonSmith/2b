import { useEffect, useState } from "react";
import { ModalShell } from "../../../../composites/ModalShell.tsx";
import { Disclosure } from "../../../../composites/Disclosure.tsx";
import { Button } from "../../../../primitives/Button.tsx";
import { Text } from "../../../../primitives/Text.tsx";
import { InlineLoading } from "../../../../composites/InlineLoading.tsx";
import type { LibraryItem } from "./types.ts";

interface LibraryPickerProps {
  open: boolean;
  onClose: () => void;
  onImport: (slug: string) => void | Promise<void>;
}

export function LibraryPicker({ open, onClose, onImport }: LibraryPickerProps) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    fetch("/api/style-guide/library")
      .then((r) => r.json())
      .then((data: { items?: LibraryItem[] }) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }, [open]);

  const handleImport = async (slug: string) => {
    setImporting(slug);
    try {
      await onImport(slug);
    } finally {
      setImporting(null);
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Import from library" width="32rem">
      <Text variant="body" tone="muted">
        Drop a starter section into your style guide. You can edit it afterwards.
      </Text>
      <div className="ep-style-section__library">
        {items === null ? (
          <InlineLoading>Loading library…</InlineLoading>
        ) : (
          items.map((item) => (
            <div key={item.slug} className="ep-style-section__library-item">
              <Disclosure summary={item.title} className="ep-style-section__library-disclosure">
                <Text variant="caption" tone="muted">{item.preview}</Text>
              </Disclosure>
              <Button
                variant="ghost"
                size="sm"
                loading={importing === item.slug}
                onClick={() => handleImport(item.slug)}
              >
                Import
              </Button>
            </div>
          ))
        )}
      </div>
    </ModalShell>
  );
}
