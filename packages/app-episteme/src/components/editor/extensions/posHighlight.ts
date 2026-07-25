import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import nlp from "compromise";
import { createDebouncedDecorationPlugin } from "./debouncedDecorations.ts";

export interface PosHighlightOptions {
  enabled: boolean;
  noun: boolean;
  verb: boolean;
  adjective: boolean;
  adverb: boolean;
}

export const defaultPosHighlightOptions: PosHighlightOptions = {
  enabled: false,
  noun: true,
  verb: true,
  adjective: true,
  adverb: true,
};

const posKey = new PluginKey<DecorationSet>("pos-highlight");

type Tag = "noun" | "verb" | "adjective" | "adverb";

function pickTag(tags: string[]): Tag | null {
  // Order matters: a word may carry many tags; prefer the most specific class.
  if (tags.includes("Adverb")) return "adverb";
  if (tags.includes("Adjective")) return "adjective";
  if (tags.includes("Verb")) return "verb";
  if (tags.includes("Noun")) return "noun";
  return null;
}

interface SentenceJson {
  terms?: Array<{
    text?: string;
    tags?: string[];
    offset?: { start?: number; length?: number };
  }>;
}

function buildDecorations(doc: ProseMirrorNode, options: PosHighlightOptions): DecorationSet {
  if (!options.enabled) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    let parsed: SentenceJson[];
    try {
      // The top-level `offset: true` is what triggers compromise to attach
      // a `{ start, length }` offset to each term — passing it only under
      // `terms` is silently ignored.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed = (nlp(text).json({ offset: true, terms: { tags: true, offset: true } } as any) as SentenceJson[]);
    } catch {
      return;
    }
    for (const sentence of parsed) {
      const terms = sentence.terms ?? [];
      for (const term of terms) {
        const start = term.offset?.start;
        const length = term.offset?.length;
        const tags = term.tags ?? [];
        if (start == null || length == null || length <= 0) continue;
        const tag = pickTag(tags);
        if (!tag) continue;
        if (!options[tag]) continue;
        const from = pos + start;
        const to = from + length;
        if (to > pos + text.length) continue;
        decos.push(Decoration.inline(from, to, { class: `pos-${tag}` }));
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

export function buildPosHighlightPlugin(getOptions: () => PosHighlightOptions) {
  return createDebouncedDecorationPlugin({
    key: posKey,
    refreshMeta: "pos-highlight-refresh",
    build: (state) => buildDecorations(state.doc, getOptions()),
  });
}

export function PosHighlightExtension(
  optionsRef: React.MutableRefObject<PosHighlightOptions>,
) {
  return Extension.create({
    name: "posHighlight",
    addProseMirrorPlugins() {
      return [buildPosHighlightPlugin(() => optionsRef.current)];
    },
  });
}
