import type { ReactNode, CSSProperties } from "react";

export type TextElement = "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "label" | "strong" | "em";
export type TextVariant = "body" | "caption" | "label" | "code" | "mono" | "heading";
export type TextTone = "default" | "muted" | "dim" | "accent" | "danger" | "success" | "warning";

interface TextProps {
  as?: TextElement;
  variant?: TextVariant;
  tone?: TextTone;
  truncate?: boolean;
  className?: string;
  children?: ReactNode;
  htmlFor?: string;
  id?: string;
  title?: string;
  style?: CSSProperties;
}

export function Text({
  as = "span",
  variant = "body",
  tone = "default",
  truncate = false,
  className,
  children,
  htmlFor,
  id,
  title,
  style,
}: TextProps) {
  const Tag = as;
  const classes = [
    "ep-text",
    `ep-text--${variant}`,
    tone !== "default" && `ep-text--${tone}`,
    truncate && "ep-text--truncate",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const extra: { htmlFor?: string } = {};
  if (Tag === "label" && htmlFor) extra.htmlFor = htmlFor;

  return (
    <Tag className={classes} id={id} title={title} style={style} {...extra}>
      {children}
    </Tag>
  );
}
