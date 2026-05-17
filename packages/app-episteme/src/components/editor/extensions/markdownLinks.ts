import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { isLocalLink, resolveLocalHref } from "../../../features/links.ts";

export interface ResolvedLocalLink {
  from: number;
  to: number;
  href: string;
  exists: boolean;
}

const markdownLinkKey = new PluginKey<DecorationSet>("markdown-link-decos");

function buildMarkdownLinkPlugin(getLinks: () => ResolvedLocalLink[]) {
  return new ProseMirrorPlugin({
    key: markdownLinkKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        if (tr.getMeta("markdown-link-refresh")) {
          const links = getLinks();
          const decos = links
            .filter((l) => !l.exists)
            .map((l) =>
              Decoration.inline(l.from, l.to, {
                class: "link-broken",
                title: `Broken link: ${l.href}`,
              }),
            );
          return decos.length ? DecorationSet.create(tr.doc, decos) : DecorationSet.empty;
        }
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    props: {
      decorations: (state) => markdownLinkKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export function MarkdownLinkDecorationExtension(
  linksRef: React.MutableRefObject<ResolvedLocalLink[]>,
) {
  return Extension.create({
    name: "markdownLinkDecoration",
    addProseMirrorPlugins() {
      return [buildMarkdownLinkPlugin(() => linksRef.current)];
    },
  });
}

export function resolveMarkdownLinks(
  doc: ProseMirrorNode,
  files: string[],
  currentFile: string,
): ResolvedLocalLink[] {
  const result: ResolvedLocalLink[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const linkMark = node.marks.find((m) => m.type.name === "link");
    if (!linkMark) return;
    const href = linkMark.attrs["href"] as string;
    if (!isLocalLink(href)) return;
    const resolved = resolveLocalHref(href, currentFile, files);
    result.push({ from: pos, to: pos + node.nodeSize, href, exists: resolved !== null });
  });
  return result;
}
