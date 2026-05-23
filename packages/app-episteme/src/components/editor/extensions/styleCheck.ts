import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { scanText, type StyleCategory, type StyleIssue } from "../../../features/style-rules.ts";

export interface StyleCheckOptions {
  enabled: boolean;
  filler: boolean;
  cliche: boolean;
  redundancy: boolean;
  strikethrough: boolean;
  tintText: boolean;
}

export const defaultStyleCheckOptions: StyleCheckOptions = {
  enabled: false,
  filler: true,
  cliche: true,
  redundancy: true,
  strikethrough: false,
  tintText: false,
};

const styleKey = new PluginKey<DecorationSet>("style-check");

export interface ResolvedStyleIssue extends StyleIssue {
  pmFrom: number;
  pmTo: number;
}

export function resolveStyleIssues(
  doc: ProseMirrorNode,
  options: StyleCheckOptions,
): ResolvedStyleIssue[] {
  const chars: string[] = [];
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const text = node.text;
      for (let i = 0; i < text.length; i++) {
        chars.push(text[i] ?? "");
        positions.push(pos + i);
      }
    }
  });
  const fullText = chars.join("");
  const issues = scanText(fullText, {
    filler: options.filler,
    cliche: options.cliche,
    redundancy: options.redundancy,
  });
  const resolved: ResolvedStyleIssue[] = [];
  for (const issue of issues) {
    if (issue.from >= positions.length || issue.to > positions.length) continue;
    const pmFrom = positions[issue.from] ?? 0;
    const pmTo = (positions[issue.to - 1] ?? 0) + 1;
    resolved.push({ ...issue, pmFrom, pmTo });
  }
  return resolved;
}

function categoryClass(c: StyleCategory, strikethrough: boolean, tintText: boolean): string {
  return (
    `style-issue style-issue--${c}` +
    (strikethrough ? " style-issue--strike" : "") +
    (tintText ? " style-issue--tint" : "")
  );
}

function buildDecorations(doc: ProseMirrorNode, options: StyleCheckOptions): DecorationSet {
  if (!options.enabled) return DecorationSet.empty;
  const issues = resolveStyleIssues(doc, options);
  if (issues.length === 0) return DecorationSet.empty;
  const decos = issues.map((issue) =>
    Decoration.inline(issue.pmFrom, issue.pmTo, {
      class: categoryClass(issue.category, options.strikethrough, options.tintText),
      title: issue.message,
    }),
  );
  return DecorationSet.create(doc, decos);
}

export function buildStyleCheckPlugin(getOptions: () => StyleCheckOptions) {
  return new ProseMirrorPlugin({
    key: styleKey,
    state: {
      init: (_, { doc }) => buildDecorations(doc, getOptions()),
      apply(tr, old, _oldState, newState) {
        if (tr.getMeta("style-check-refresh")) {
          return buildDecorations(newState.doc, getOptions());
        }
        if (tr.docChanged) {
          return buildDecorations(newState.doc, getOptions());
        }
        return old;
      },
    },
    props: {
      decorations: (state) => styleKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export function StyleCheckExtension(
  optionsRef: React.MutableRefObject<StyleCheckOptions>,
) {
  return Extension.create({
    name: "styleCheck",
    addProseMirrorPlugins() {
      return [buildStyleCheckPlugin(() => optionsRef.current)];
    },
  });
}
