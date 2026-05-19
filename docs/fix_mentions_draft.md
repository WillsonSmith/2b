# [Draft] Fix File Mention Expansion Issue

## 1. Structured Overview (Index)

### I. Problem Statement
* **Core Issue:** File mention expansion and clutter upon application relaunch. `[ref 1, 2]`
* **Root Cause Analysis:** Hypothesis regarding `AISidecar.tsx` drafting and the planning feature's lack of tool access. `[ref 3]`

### 2. Proposed Solutions
* **Option 1: Hidden Injection**
    * *Mechanism:* Suppress rendering of injected text in the chat UI. `[ref 4]`
* **Option 2: Reference-Only (On-Demand)**
    * *Mechanism:* Maintain references only; fetch content on-demand. `[ref 5]`
    * *Key Benefit:* Capability to expand feature to directory referencing. `[ref 6]`
* ** Оption 3: Collapsible Injection (Preferred)**
    * *Mechanism:* Use `<details>` elements for transparency. `[ref 7]`
    * *Key Benefit:* UI for manual removal of specific file references. `[ref 8]`

### 3. Technical Considerations & Edge Cases
* **Large File Handling:** Performance risks associated with large file injection. `[ref 9]`
* **Warning Mechanisms:** Implementing warnings in the mentions popup for large files. `[ref 10]`

---

## 2. Annotated Original Text

`[ref 1]` There is an issue with the drafting feature of Episteme ( `packages/app-episteme/` ). `[ref 2]` Previously, when a file was mentioned, the message would show `@file_name.md`. Right now, it works that way when the original message is sent, but if I re-launch the app, then the full document is injected into the message.

`[ref 3]` I think this problem was introduced when we added the ability to . . . create drafts from `@packages/app-episteme/src/components/AISidecar.tsx`. The planning feature does not have direct access to the project or its tools because it is only responsible for structuring the step-by-step plan. I think references were set to send the full text because of this. This makes sense, but in the context of the message, it becomes clutter.

**Considering Solutions:**
`[ref 4]` 1. Simply do not render the referenced document, hide it. Continue injecting the document but ensure it does not render in the message.
`[ref 5]` 2. Do not inject the documents, keep them as references only. Have the app pull them in on-demand. `[ref 6]` However, if I keep files as reference-only and fetched on-demand is that the feature could be adapted for referencing directories. Right now, it is not possible to reference a directory. However, I would like to be . . . able to do that and then it could list the contents of that directory.
`[ref 7]` 3. Inject the documents, but add a collapsible section like the function references and plan steps (but inside the message). I'm leaning towards number 3 so that there is transparency into what the app is doing. `[ref 8]` Additionally, it would provide a good UI for removing a reference to a file. For example: perhaps a message included a file, but I do not want to re-submit that file on a future turn, then I could remove it.

**General Problems:**
`[ref 9]` One general problem with the inject approach is that some files are very large. When the user opens a large file, a warning banner appears in the editor to say that the AI features may be slow or truncated. There is no such behaviour for the file mention and attachment. `[ref 10]` If we maintain the inject approach, then it would be nice to have a warning on the mentions popup when a file is large. Even if we do just references, having a warning would be nice.
