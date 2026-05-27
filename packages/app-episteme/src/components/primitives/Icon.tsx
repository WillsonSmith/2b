import type { LucideIcon } from "lucide-react";

export type IconSize = "xs" | "sm" | "md" | "lg" | number;

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
  strokeWidth?: number;
}

const SIZE_PX: Record<Exclude<IconSize, number>, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
};

export function Icon({
  icon: LucideComp,
  size = "md",
  className,
  strokeWidth,
  ...aria
}: IconProps) {
  const px = typeof size === "number" ? size : SIZE_PX[size];
  return (
    <LucideComp
      size={px}
      strokeWidth={strokeWidth}
      className={className ? `ep-icon ${className}` : "ep-icon"}
      aria-hidden={aria["aria-hidden"] ?? (aria["aria-label"] ? undefined : true)}
      aria-label={aria["aria-label"]}
    />
  );
}
