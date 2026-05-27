import type { FC } from "react";
import { Search, List, PenLine, Pencil, Quote, BarChart2, FolderOpen } from "lucide-react";
import type { EpistemePlanStepType } from "../../../planning/types.ts";

export const PLAN_STEP_TYPE_ICONS: Record<EpistemePlanStepType, FC<{ size?: number; className?: string }>> = {
  research: ({ size = 11, className }) => <Search size={size} className={className} />,
  outline:  ({ size = 11, className }) => <List size={size} className={className} />,
  draft:    ({ size = 11, className }) => <PenLine size={size} className={className} />,
  edit:     ({ size = 11, className }) => <Pencil size={size} className={className} />,
  cite:     ({ size = 11, className }) => <Quote size={size} className={className} />,
  analyze:  ({ size = 11, className }) => <BarChart2 size={size} className={className} />,
  organize: ({ size = 11, className }) => <FolderOpen size={size} className={className} />,
};
