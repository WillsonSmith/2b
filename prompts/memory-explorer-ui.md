I want to add a `/memory` slash command to the terminal UI that opens an interactive memory explorer overlay. Please read the following files for context before writing any code:

- `src/ui/terminal/slashCommands.ts` — how slash commands are structured and how `session.addSystemMessage` is used
- `src/ui/terminal/TerminalChat.tsx` — the root Ink component and how state/overlays could be added
- `src/ui/terminal/MessageItem.tsx` — existing Ink component patterns to follow
- `src/plugins/CortexMemoryPlugin.ts` — the memory storage layer; understand what methods are available for listing, searching, and deleting memories
- `src/cli/memory-cmd.ts` — the existing CLI memory commands; these cover the same operations you need to expose in the UI

**What to build:**

An interactive Ink overlay component (`MemoryExplorer.tsx`) that renders on top of the chat when `/memory` is typed. It should:

1. **List view** — show all stored memories, one per line, with arrow key navigation and a highlighted selection. Show a truncated preview of each memory's content.
2. **Search** — a text field at the top (activated by pressing `/` or `s`) that filters the list live as the user types.
3. **Delete** — pressing `d` or `Delete` on a selected memory prompts "Delete? (y/n)" and removes it on confirmation.
4. **Detail view** — pressing `Enter` on a memory expands it to show the full content.
5. **Dismiss** — pressing `Escape` or `q` closes the overlay and returns to the chat.

**Integration:**

- Add `/memory` to `slashCommands.ts`. It should set a piece of state in `TerminalChat` that shows the overlay rather than adding a system message.
- The overlay should sit between the message list and the input bar in the component tree — when it is open, the input bar should be hidden.
- Follow the visual style of the existing components: cyan for interactive elements, gray for secondary text, bordered boxes.

**Do not** modify `CortexMemoryPlugin` or any core agent code. Read memory data through whatever public API the plugin already exposes. If that API is insufficient, add a minimal read-only helper in the UI layer only.
