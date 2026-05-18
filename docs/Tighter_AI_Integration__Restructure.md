# AI Integration Roadmap: Episteme

## Overview

Improve the integration between the `AISidecar.tsx` chat interface and the document editor to enable more direct interaction between open documents and the AI.

## Feature 1: Placeholder Blocks

**Concept:** Modeled after the existing Diagram generation feature. **Mechanism:**

1. User inserts a placeholder block into a document.
2. User provides instructions within the block.
3. User clicks a "Generate" button (sparkle icon).
4. AI reads the document and the block instructions to fill the block with content. **Workflow:** Support for "Process All" functionality, where the AI iterates through multiple blocks sequentially, reading the current document state before each generation. **Benefit:** Moves AI instruction handling from the chat sidebar directly into the editor, facilitating better drafting.

## Feature 2: Refined Editor Popover

**Current State:** The text selection popover is cluttered with AI tools (Link, Professional, Casual, Academic, TL;DR, Table, Ask AI). **Proposed Change:**

- Limit the popover strictly to formatting tools.
- Implement a "Send to Chat" or "Ask AI" mechanism. **Implementation Detail:** Selecting text and clicking "Ask AI" should populate the `AISidecar` chat with a reference (e.g., `@filename.md[line range/index]`) and allow for free-text follow-up.

## Feature 3: AISidecar as a Persistent Action Log

**Goal:** Transform the `AISidecar` into a persistent record of all AI-driven actions and tool executions. **Requirements:**

- **Persistence:** Tool status updates and action logs must persist across application restarts.
- **Tool Feedback Improvements:**
  - **Error Handling:** Fix the bug where failed tools display a success checkmark. Failed tools must display a failure indicator.
  - **Detail Expansion:** Use `<details>` elements to show the tool run and expand to reveal a summary of the response.
- **Planning Integration:**
  - Add indicators to the chat view for active plan steps (similar to tool indicators).
  - The indicator should show "Running," then update to "Completed" with a summary once the step finishes.

## Feature 4: AISidecar Interface & Workflow Updates

### Message Actions

- **Change:** Remove "Execute" and "Continue" actions from message items.
- **Replacement:** Implement a "Tools" dropdown menu.

### Integrated Planning Workflow

**Goal:** Enable users to initiate planning directly from the `AISidecar`. **Workflow:**

1. **Planning Mode:** A new state for the `AISidecar` chat.
2. **UI Elements:** Surface options above the chat input:
   - "Approve all at once"
   - "Approve step-by-step"
   - "Plan from current document"
3. **Execution:** Upon submission, the `PlanPanel` opens to display the generated plan and manage the process.
4. **Contextual Awareness:** Ensure `@filename.md` mentions work within this planning mode. **Separation of Context:** The `PlanPanel` remains the primary interface for viewing and editing the full plan, while the `ASidecar` serves as the initiation point.