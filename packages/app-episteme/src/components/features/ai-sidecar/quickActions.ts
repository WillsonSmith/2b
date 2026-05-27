export interface QuickAction {
  label: string;
  prompt: string;
}

export const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  {
    label: "Wikipedia Research",
    prompt:
      "Search Wikipedia for the main topics in my current document. Summarize the key findings and save them as a new workspace document.",
  },
  {
    label: "arXiv Papers",
    prompt:
      "Search arXiv for academic papers related to the topics in my current document. Save a structured summary of the most relevant findings.",
  },
  {
    label: "Summarize Workspace",
    prompt:
      "Read all documents in the workspace and produce a comprehensive summary of the key themes, main arguments, and connections between them.",
  },
  {
    label: "Find Connections",
    prompt:
      "Identify meaningful connections, overlapping topics, and relationships between all documents in the workspace. List the most significant ones.",
  },
];

export function toolDisplayName(name: string): string {
  return name.replace(/_/g, " ");
}
