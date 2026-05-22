import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type FocusLevel = "sentence" | "paragraph";

export interface FocusModeOptions {
  enabled: boolean;
  level: FocusLevel;
}

export const defaultFocusModeOptions: FocusModeOptions = {
  enabled: false,
  level: "sentence",
};

const focusKey = new PluginKey<DecorationSet>("focus-mode");

function findBlockRange(doc: ProseMirrorNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.isTextblock) {
      const from = $pos.start(depth);
      const to = $pos.end(depth);
      return { from, to };
    }
  }
  // Top-level fallback
  return { from: 0, to: doc.content.size };
}

interface BlockText {
  text: string;
  positions: number[]; // pm position of char i
}

function collectBlockText(doc: ProseMirrorNode, from: number, to: number): BlockText {
  const chars: string[] = [];
  const positions: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      const text = node.text;
      for (let i = 0; i < text.length; i++) {
        chars.push(text[i] ?? "");
        positions.push(pos + i);
      }
    }
    return true;
  });
  return { text: chars.join(""), positions };
}

function findSentenceRange(
  doc: ProseMirrorNode,
  cursor: number,
  block: { from: number; to: number },
): { from: number; to: number } {
  const collected = collectBlockText(doc, block.from, block.to);
  if (collected.text.length === 0) return block;
  // Find which char index the cursor sits at (or just before).
  let charIndex = collected.positions.findIndex((p) => p >= cursor);
  if (charIndex === -1) charIndex = collected.positions.length - 1;
  if (charIndex < 0) charIndex = 0;

  const text = collected.text;
  // Walk backward to start of sentence
  let start = charIndex;
  while (start > 0) {
    const prev = text[start - 1] ?? "";
    if (/[.!?]/.test(prev)) break;
    start--;
  }
  // Skip leading whitespace
  while (start < text.length && /\s/.test(text[start] ?? "")) start++;

  // Walk forward to end of sentence (inclusive of terminal punctuation)
  let end = charIndex;
  while (end < text.length) {
    const c = text[end] ?? "";
    end++;
    if (/[.!?]/.test(c)) break;
  }

  if (end <= start) return block;
  const fromPos = collected.positions[start] ?? block.from;
  const toPos = (collected.positions[end - 1] ?? block.from) + 1;
  return { from: fromPos, to: toPos };
}

function buildDecorations(state: EditorState, options: FocusModeOptions): DecorationSet {
  if (!options.enabled) return DecorationSet.empty;
  const { doc, selection } = state;
  const cursor = selection.from;
  const block = findBlockRange(doc, cursor);
  if (!block) return DecorationSet.empty;
  const active =
    options.level === "paragraph"
      ? block
      : findSentenceRange(doc, cursor, block);
  if (active.from <= 0 && active.to >= doc.content.size) return DecorationSet.empty;
  const decos: Decoration[] = [];
  if (active.from > 0) {
    decos.push(Decoration.inline(0, active.from, { class: "focus-dimmed" }));
  }
  if (active.to < doc.content.size) {
    decos.push(Decoration.inline(active.to, doc.content.size, { class: "focus-dimmed" }));
  }
  return DecorationSet.create(doc, decos);
}

export function buildFocusModePlugin(getOptions: () => FocusModeOptions) {
  return new ProseMirrorPlugin({
    key: focusKey,
    state: {
      init: (_, state) => buildDecorations(state, getOptions()),
      apply(tr, old, _oldState, newState) {
        if (
          tr.getMeta("focus-mode-refresh") ||
          tr.docChanged ||
          tr.selectionSet
        ) {
          return buildDecorations(newState, getOptions());
        }
        return old;
      },
    },
    props: {
      decorations: (state) => focusKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export function FocusModeExtension(
  optionsRef: React.MutableRefObject<FocusModeOptions>,
) {
  return Extension.create({
    name: "focusMode",
    addProseMirrorPlugins() {
      return [buildFocusModePlugin(() => optionsRef.current)];
    },
  });
}
