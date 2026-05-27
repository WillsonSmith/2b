import type { InputHTMLAttributes, ReactNode, Ref } from "react";

export type InputSize = "sm" | "md";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  size?: InputSize;
  invalid?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Input({
  size = "md",
  invalid = false,
  prefix,
  suffix,
  className,
  ref,
  ...rest
}: InputProps) {
  const wrapperClasses = [
    "ep-input",
    `ep-input--${size}`,
    invalid && "ep-input--invalid",
    rest.disabled && "ep-input--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={wrapperClasses}>
      {prefix && <span className="ep-input__affix ep-input__affix--prefix">{prefix}</span>}
      <input
        {...rest}
        ref={ref}
        aria-invalid={invalid || undefined}
        className="ep-input__field"
      />
      {suffix && <span className="ep-input__affix ep-input__affix--suffix">{suffix}</span>}
    </span>
  );
}
