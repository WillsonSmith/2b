import type { FC } from "react";
import { Search, List, PenLine, Pencil, Quote, BarChart2, FolderOpen } from "lucide-react";
import type { EpistemePlanStepType } from "../../../planning/types.ts";

export const STEP_TYPE_ICONS: Record<EpistemePlanStepType, FC<{ size?: number; className?: string }>> = {
  research:  ({ size = 14, className }) => <Search size={size} className={className} />,
  outline:   ({ size = 14, className }) => <List size={size} className={className} />,
  draft:     ({ size = 14, className }) => <PenLine size={size} className={className} />,
  edit:      ({ size = 14, className }) => <Pencil size={size} className={className} />,
  cite:      ({ size = 14, className }) => <Quote size={size} className={className} />,
  analyze:   ({ size = 14, className }) => <BarChart2 size={size} className={className} />,
  organize:  ({ size = 14, className }) => <FolderOpen size={size} className={className} />,
};

export const STEP_TYPE_LABELS: Record<EpistemePlanStepType, string> = {
  research: "Research",
  outline:  "Outline",
  draft:    "Draft",
  edit:     "Edit",
  cite:     "Cite",
  analyze:  "Analyze",
  organize: "Organize",
};

export const ALL_STEP_TYPES: ReadonlyArray<EpistemePlanStepType> = [
  "research", "outline", "draft", "edit", "cite", "analyze", "organize",
];
