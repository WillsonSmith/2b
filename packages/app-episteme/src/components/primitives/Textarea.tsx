import { useEffect, useRef } from "react";
import type { Ref, TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  autosize?: boolean;
  maxAutosizeRows?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({
  invalid = false,
  autosize = false,
  maxAutosizeRows,
  className,
  value,
  rows = 2,
  ref: externalRef,
  ...rest
}: TextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof externalRef === "function") externalRef(el);
    else if (externalRef && "current" in externalRef) {
      (externalRef as { current: HTMLTextAreaElement | null }).current = el;
    }
  };

  useEffect(() => {
    if (!autosize) return;
    const el = innerRef.current;
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
      ref={setRef}
      rows={rows}
      value={value}
      aria-invalid={invalid || undefined}
      className={classes}
    />
  );
}
