import { useEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  autosize?: boolean;
  maxAutosizeRows?: number;
}

export function Textarea({
  invalid = false,
  autosize = false,
  maxAutosizeRows,
  className,
  value,
  rows = 2,
  ...rest
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autosize) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const cap = maxAutosizeRows ? lineHeight * maxAutosizeRows : Infinity;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [value, autosize, maxAutosizeRows]);

  const classes = [
    "ep-textarea",
    invalid && "ep-textarea--invalid",
    rest.disabled && "ep-textarea--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      value={value}
      aria-invalid={invalid || undefined}
      className={classes}
    />
  );
}
