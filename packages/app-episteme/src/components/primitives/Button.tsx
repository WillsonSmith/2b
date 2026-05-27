import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Loader2 } from "lucide-react";
import { Icon } from "./Icon.tsx";

export type ButtonVariant = "solid" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md";
export type ButtonShape = "rect" | "square" | "circle";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "ghost",
  size = "md",
  shape = "rect",
  iconLeft,
  iconRight,
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const classes = [
    "ep-button",
    `ep-button--${variant}`,
    `ep-button--${size}`,
    `ep-button--${shape}`,
    loading && "ep-button--loading",
    !children && "ep-button--icon-only",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <Icon icon={Loader2} size={size === "sm" ? "sm" : "md"} className="ep-button__spinner" />
      ) : (
        iconLeft && <span className="ep-button__icon ep-button__icon--left">{iconLeft}</span>
      )}
      {children && <span className="ep-button__label">{children}</span>}
      {!loading && iconRight && (
        <span className="ep-button__icon ep-button__icon--right">{iconRight}</span>
      )}
    </button>
  );
}
