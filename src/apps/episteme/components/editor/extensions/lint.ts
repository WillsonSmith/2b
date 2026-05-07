import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { LintIssue } from "../../../features/lint.ts";

export interface ResolvedIssue extends LintIssue {
  pmFrom: number;
  pmTo: number;
}

const lintKey = new PluginKey<DecorationSet>("lint-decos");

export function buildLintPlugin(getIssues: () => ResolvedIssue[]) {
  return new ProseMirrorPlugin({
    key: lintKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        if (tr.getMeta("lint-refresh")) {
          const issues = getIssues();
          if (!issues.length) return DecorationSet.empty;
          const decos = issues.map((issue) =>
            Decoration.inline(issue.pmFrom, issue.pmTo, {
              class: `lint-${issue.type}`,
              title: `[${issue.type}] ${issue.suggestion}`,
            }),
          );
          return DecorationSet.create(tr.doc, decos);
        }
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    props: {
      decorations: (state) => lintKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export function LintExtension(lintRef: React.MutableRefObject<ResolvedIssue[]>) {
  return Extension.create({
    name: "lint",
    addProseMirrorPlugins() {
      return [buildLintPlugin(() => lintRef.current)];
    },
  });
}

export function resolveIssuePositions(doc: ProseMirrorNode, issues: LintIssue[]): ResolvedIssue[] {
  const chars: string[] = [];
  const positions: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i] ?? "");
        positions.push(pos + i);
      }
    }
  });

  const fullText = chars.join("");
  const resolved: ResolvedIssue[] = [];

  for (const issue of issues) {
    const idx = fullText.indexOf(issue.text);
    if (idx === -1 || idx + issue.text.length > positions.length) continue;
    const pmFrom = positions[idx] ?? 0;
    const pmTo = (positions[idx + issue.text.length - 1] ?? 0) + 1;
    resolved.push({ ...issue, pmFrom, pmTo });
  }

  return resolved;
}
