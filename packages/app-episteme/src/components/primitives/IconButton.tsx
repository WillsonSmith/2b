import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import type { ButtonProps } from "./Button.tsx";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "iconLeft" | "iconRight"> {
  icon: ReactNode;
  "aria-label": string;
}

export function IconButton({ icon, shape = "square", ...rest }: IconButtonProps) {
  return <Button shape={shape} iconLeft={icon} {...rest} />;
}
