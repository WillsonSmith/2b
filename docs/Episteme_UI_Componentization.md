# Task
Audit `packages/app-episteme` and plan a new, hierarchical component architecture that decomposes complex "Feature Components" into smaller, reusable units.

# Constraints

### 1. Component Hierarchy (Pattern)
* **Primitives (Stateless):** The smallest, purely presentational building blocks (e.g., Buttons, Icons, Typography).
* **Composites (Stateless):** Small, reusable units composed of Primitives (e.g., Input fields, List items).
* **Feature Components (Stateful):** Complex units that handle specific business logic and interactions (e.g., `MessageList`, `InputArea`). These are permitted to manage or consume state.

###   2. Technical Stack & Styling
* **Styling Engine:** Standard CSS (CSS variables and properties) for shared styles.
* **Icon Library:** `lucide-react`.
* **UI Primitives:** Build from scratch (no external UI libraries).
* **Robustness:** Components must handle multiple use cases (e.g., a Button must support icon-only, icon+text, and various shapes like circular).

### 3. Definition of Done (Rules of Engagement)
* **Type Safety:** Strict TypeScript implementation for all props and interfaces.
* **Side Effects:** No API calls or state mutations allowed within Primitives or Composites.
* **Logic Boundary:** Maintain a strict Logic/Presentation split; Primitives and Composites must remain stateless.

# Reference Data

### Problem Statement
Currently, components in `packages/app-episteme` function as "Feature Components"—large, complex sections of UI that contain significant state and logic. This creates high overhead for Claude Code when implementing new features.

### Target Directories
* **Components:** `packages/app-episteme/src/components`
* **Styles:** `packages/app-episteme/src/styles`

### Example of Current Complex UI (Subject for Audit)
`packages/app-episteme/src/components/AISidecar.tsx` is a complex template containing:
* **Resizable panel**
* **Header:** Title (text), Button (icon)
* **MessageList:**
    * Tool rows (summaries with disclosure arrows, status indicators, details)
    * Notifications, System events, Empty responses
    * Plan steps (State, Title, Summary, Errors, Results)
    * AssistantMessage (Dropdown menu, Delete button, Markdown message, Followup input)
    * User messages (Delete button, Mentions footer with `FileMentionChip`)
    * Thinking indicator
* **Input Area (`sicecar-input-area`):**
    * Quick actions (buttons), Mentions dropdown, Followup badge, PlanModeOptions
    * Text area (input), Input toolbar (Quick actions, planning mode, followup plan, status, send)
* **Modal view of messages**

# Output Format
Provide a structured Markdown outline of the proposed component hierarchy, categorized by Primitives, Composites, and Feature Components.