import { useState } from "react";
import { ModalShell } from "../../../../composites/ModalShell.tsx";
import { InlineLoading } from "../../../../composites/InlineLoading.tsx";
import { Button } from "../../../../primitives/Button.tsx";
import { Input } from "../../../../primitives/Input.tsx";
import { Textarea } from "../../../../primitives/Textarea.tsx";
import { Text } from "../../../../primitives/Text.tsx";

interface GenerateModalProps {
  open: boolean;
  onClose: () => void;
  /** Persist the (possibly edited) draft as a new section. */
  onAdd: (title: string, body: string) => void | Promise<void>;
}

interface Draft {
  title: string;
  body: string;
}

export function GenerateModal({ open, onClose, onAdd }: GenerateModalProps) {
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setDescription(""); setDraft(null); setBusy(false); setError(null); };
  const handleClose = () => { reset(); onClose(); };

  const generate = async () => {
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/style-guide/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = (await res.json()) as { title?: string; body?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Generation failed.");
      setDraft({ title: data.title ?? "Untitled", body: data.body ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await onAdd(draft.title.trim() || "Untitled", draft.body);
      handleClose();
    } finally {
      setBusy(false);
    }
  };

  const footer = draft ? (
    <>
      <Button variant="ghost" onClick={generate} loading={busy} disabled={busy}>
        Regenerate
      </Button>
      <div style={{ flex: 1 }} />
      <Button variant="solid" onClick={add} loading={busy} disabled={busy || !draft.body.trim()}>
        Add to guide
      </Button>
    </>
  ) : (
    <>
      <div style={{ flex: 1 }} />
      <Button variant="solid" onClick={generate} loading={busy} disabled={busy || !description.trim()}>
        Generate
      </Button>
    </>
  );

  return (
    <ModalShell open={open} onClose={handleClose} title="Generate a style section" width="34rem" footer={footer}>
      <Text variant="body" tone="muted">
        Describe the voice, tone, or rules you want. Generates one focused section you can edit before adding.
      </Text>
      <div className="ep-style-section__generate">
        <Textarea
          autosize
          maxAutosizeRows={6}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={"e.g. Punchy, skimmable voice for a tech blog — short paragraphs, concrete examples, no hype."}
          spellCheck={false}
          aria-label="Style description"
          disabled={busy && !draft}
        />
        {busy && !draft && <InlineLoading>Generating…</InlineLoading>}
        {error && <Text variant="caption" tone="danger">{error}</Text>}
        {draft && (
          <div className="ep-style-section__generate-preview">
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              aria-label="Generated section title"
            />
            <Textarea
              autosize
              maxAutosizeRows={18}
              rows={6}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              spellCheck={false}
              aria-label="Generated section body"
            />
          </div>
        )}
      </div>
    </ModalShell>
  );
}
