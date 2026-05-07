import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";

const ghostKey = new PluginKey<DecorationSet>("ghost-text");

export function buildGhostPlugin(getGhost: () => string) {
  return new ProseMirrorPlugin({
    key: ghostKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, _old) {
        const ghost = getGhost();
        if (!ghost) return DecorationSet.empty;
        const sel = tr.selection;
        const pos = sel.from;
        const deco = Decoration.widget(pos, () => {
          const span = document.createElement("span");
          span.className = "ghost-text";
          span.textContent = ghost;
          return span;
        });
        return DecorationSet.create(tr.doc, [deco]);
      },
    },
    props: {
      decorations(state) {
        return ghostKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

export function GhostTextExtension(
  ghostRef: React.MutableRefObject<string>,
  onAccept: (t: string) => void,
  onDismiss: () => void,
) {
  return Extension.create({
    name: "ghostText",
    addProseMirrorPlugins() {
      return [buildGhostPlugin(() => ghostRef.current)];
    },
    addKeyboardShortcuts() {
      return {
        Tab: () => {
          const ghost = ghostRef.current;
          if (!ghost) return false;
          this.editor.commands.insertContent(ghost);
          onAccept(ghost);
          return true;
        },
        Escape: () => {
          if (!ghostRef.current) return false;
          onDismiss();
          return true;
        },
      };
    },
  });
}
