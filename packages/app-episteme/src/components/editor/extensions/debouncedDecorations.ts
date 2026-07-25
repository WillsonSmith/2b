import { DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, type PluginKey, type EditorState } from "@tiptap/pm/state";

/**
 * Builds a ProseMirror decoration plugin whose decorations are expensive to
 * compute over the whole document (NLP tagging, full-text style scanning,
 * etc.). Rebuilding on every keystroke blocks typing in large documents, so:
 *
 *  - On `docChanged`, the existing decorations are *mapped* through the change
 *    (O(#decorations), keeps positions valid) and a full rebuild is scheduled
 *    on a debounce.
 *  - On the `refreshMeta` transaction (dispatched when the feature's options
 *    toggle, or by the debounced scheduler), the decorations are rebuilt from
 *    scratch.
 *
 * The net effect: decorations track the text within `debounceMs` of the last
 * edit, and lag harmlessly (mapped, not recomputed) while the user is actively
 * typing.
 */
export function createDebouncedDecorationPlugin(opts: {
  key: PluginKey<DecorationSet>;
  refreshMeta: string;
  build: (state: EditorState) => DecorationSet;
  debounceMs?: number;
}): ProseMirrorPlugin<DecorationSet> {
  const { key, refreshMeta, build, debounceMs = 250 } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new ProseMirrorPlugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => build(state),
      apply(tr, old, _oldState, newState) {
        if (tr.getMeta(refreshMeta)) return build(newState);
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    view(view) {
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (view.isDestroyed) return;
          view.dispatch(view.state.tr.setMeta(refreshMeta, true));
        }, debounceMs);
      };
      return {
        update(_view, prevState) {
          // ProseMirror reuses the doc node reference when a transaction leaves
          // the document unchanged, so this is an O(1) "did the doc change?".
          if (prevState.doc !== view.state.doc) schedule();
        },
        destroy() {
          if (timer) clearTimeout(timer);
        },
      };
    },
    props: {
      decorations: (state) => key.getState(state) ?? DecorationSet.empty,
    },
  });
}
