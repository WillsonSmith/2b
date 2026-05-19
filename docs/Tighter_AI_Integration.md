# AI Integration Improvements

I want to improve the AI integration in Episteme. Right now, the AISidecar.tsx chat feels a little disconnected from the editing process. It can be used to edit, and it can be used to perform tasks across the project, but there is very little direct back and forth between an open document and the chat interface.

## Desired Features

This is a series of features I would like to build in order to improve the AI integration of Episteme.

### Placeholder blocks

The Diagram generating feature of the editor has a behaviour that I like: The user clicks the diagram button, enters text to tell the AI what to generate, and then a placeholder block is inserted that is updated once the AI finishes processing the request. This allows the user to continue editing the document while Episteme is generating the diagram.

This gave me an idea for a new feature similar to this. It would be nice if I could insert a block into a document, and in that block type what I want it to be filled with. Then, the user could click a generate button (with the sparkle icon) and the AI would read the document, and fill in the block according to what is in the document and what the instructions say. I would also like a way to go through each block one-by-one. So, if I create 3 blocks and click the process all it would read the document and generate the first, read the document again and generate the second, read the document again and generate the third.

This feature would allow for better drafting of documents instead of relying on the AI to be smart enough to guess what the user wants to do based on a chat message. This helps move AI functionality out of the chat and into the editor.

### General Editor Features

Currently, if a user selects text, there is a popover with the following tools: Link, Professional, Casual, Academic, TL;DR, Table, and Ask AI. This feels overly complicated for a menu of this type. I think this popup should be limited to formatting features. However, I do want a way to process text with AI.

One way could be the ability to reference specific lines or text within the chat interface. Maybe a "send to chat" button that automatically inserts it into the chat box. Right now the AI tools in the popup immediately perform tasks, but I think I want to be able to manually tell it what to do. The process would look something like this: Select text, click "Ask AI", the AISidecar chat box would be populated with something like @filename.md\[line number or index and or range\] and then allow for free text.

### AISidecar Feedback Integration

When the AI performs tasks, it presents an indicator when tools are running. I like this, it provides feedback to the user that some task is running. I want to expand on this feedback. This will turn the sidecar into a sort of log of all actions taken.

One thing I want to do is ensure that the status updates are persisted in this panel in addition to the messages. Right now, if I ask the AI to do something, it performs an action with a tool, and then responds. Those 3 UI items will show, but if I restart the application, the tool actions performed will disappear. I want them to persist so that the "log" in the chat UI will be a full record.

#### Tool Feedback Updates

There is a problem with the tool indicators: When a tool fails, the UI indicates that it was successful / completed with a checkmark icon. This should not happen. if a tool failed then the UI should indicate that the tool failed.

When a tool completes or fails, I want to include information about the response in the UI. This could be done with a `<details>` element that shows the tool that was run and expands to show the details of the response, possibly a summary.

#### Planning Integration

When a user creates a plan with the PlanningPlugin and the PlanPanel.tsx, everything that happens with the plan lives in the plan panel. The AISidecar provides feedback only when it returns a message per step. This is okay, but I want to add more context. When a plan task is running, I want to add an indicator in the chat view, much like when a tool runs. It should indicate what step is running. It can re-use the UI from the plan panel.

The plan indicator should show it is running, and then when it is finished, update to show it is completed and show the completion summary. So, when a plan step finishes, this UI would be updated and then the AI message would come in after it like normal.

### AISidecar feature updates

#### Message Actions

AISidecar currently has two actions on every message: Execute and Continue. I want to remove these. They are not particularly useful. Instead. I want to instead have a tools dropdown menu

#### Integrating planning

I want a way to start a plan from the AISidecar. Right now the only way to create a plan is in the plan panel. I think a good starting point would be to be able to turn the chat into a "planning mode". I don't hate the plan feature being in its own panel, but it does feel a little disjointed from the AI process. Maybe the planning panel can be for displaying and editing the full plan, but the plan can be initiated from the chat bar.

Right now, the planning panel has a textarea where the user writes what they want to accomplish. Instead, the chat UI could be turned into planning mode, and it could surface "Approve all at once, Approve step-by-step, and "Plan from current document" above the chat box, but when submitted it would open the plan panel to show the actual process. I think this would be a good separation of concerns for now.

By doing this, it would also enable the user to use @ mentions for files. Currently, the chat allows for @ mentions, but the plan feature does not have @ mentions.