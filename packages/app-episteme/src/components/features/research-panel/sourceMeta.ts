import type { SearchResult } from "../../../plugins/ResearchPlugin.ts";
import type { BadgeTone } from "../../primitives/Badge.tsx";

interface SourceMeta {
  label: string;
  tone: BadgeTone;
}

export const SOURCE_META: Record<SearchResult["source"], SourceMeta> = {
  arxiv: { label: "arXiv", tone: "info" },
  wikipedia: { label: "Wikipedia", tone: "success" },
  workspace: { label: "Workspace", tone: "neutral" },
};
