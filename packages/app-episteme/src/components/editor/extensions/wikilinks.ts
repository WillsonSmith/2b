import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { WIKILINK_RE, resolveWikilinkTarget } from "../../../features/wikilinks.ts";

export interface ResolvedWikilink {
  from: number;
  to: number;
  target: string;
  exists: boolean;
}

const wikilinkKey = new PluginKey<DecorationSet>("wikilink-decos");

export function buildWikilinkPlugin(getLinks: () => ResolvedWikilink[]) {
  return new ProseMirrorPlugin({
    key: wikilinkKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        if (tr.getMeta("wikilink-refresh")) {
          const links = getLinks();
          if (!links.length) return DecorationSet.empty;
          const decos = links.map((l) =>
            Decoration.inline(l.from, l.to, {
              class: l.exists ? "wikilink" : "wikilink-broken",
              "data-target": l.target,
            }),
          );
          return DecorationSet.create(tr.doc, decos);
        }
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    props: {
      decorations: (state) => wikilinkKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export function WikilinkExtension(linksRef: React.MutableRefObject<ResolvedWikilink[]>) {
  return Extension.create({
    name: "wikilink",
    addProseMirrorPlugins() {
      return [buildWikilinkPlugin(() => linksRef.current)];
    },
  });
}

export function resolveWikilinks(doc: ProseMirrorNode, files: string[]): ResolvedWikilink[] {
  const chars: string[] = [];
  const positions: number[] = [];
  const inCode: boolean[] = [];

  doc.descendants((node, pos, parent) => {
    if (node.isText && node.text) {
      const isCode =
        node.marks.some((m) => m.type.name === "code") ||
        parent?.type.name === "codeBlock";
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i] ?? "");
        positions.push(pos + i);
        inCode.push(isCode);
      }
    }
    return true;
  });

  const flat = chars.join("");
  const out: ResolvedWikilink[] = [];

  for (const m of flat.matchAll(WIKILINK_RE)) {
    const idx = m.index ?? 0;
    if (inCode[idx]) continue;
    const len = m[0].length;
    const from = positions[idx] ?? 0;
    const to = (positions[idx + len - 1] ?? 0) + 1;
    const target = (m[1] ?? "").trim();
    out.push({
      from,
      to,
      target,
      exists: resolveWikilinkTarget(target, files) !== null,
    });
  }

  return out;
}

export interface WikilinkPopupKeyHandlers {
  open: boolean;
  onArrowUp: () => void;
  onArrowDown: () => void;
  onEnter: () => boolean;
  onEscape: () => boolean;
}

export function WikilinkPopupExtension(ref: React.MutableRefObject<WikilinkPopupKeyHandlers>) {
  return Extension.create({
    name: "wikilinkPopup",
    addKeyboardShortcuts() {
      return {
        ArrowDown: () => {
          if (!ref.current.open) return false;
          ref.current.onArrowDown();
          return true;
        },
        ArrowUp: () => {
          if (!ref.current.open) return false;
          ref.current.onArrowUp();
          return true;
        },
        Enter: () => {
          if (!ref.current.open) return false;
          return ref.current.onEnter();
        },
        Tab: () => {
          if (!ref.current.open) return false;
          return ref.current.onEnter();
        },
        Escape: () => {
          if (!ref.current.open) return false;
          return ref.current.onEscape();
        },
      };
    },
  });
}
