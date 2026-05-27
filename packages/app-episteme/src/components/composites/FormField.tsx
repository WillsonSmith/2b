import { useId } from "react";
import type { ReactElement, ReactNode } from "react";

interface FormFieldProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactElement | ((props: { id: string }) => ReactElement);
  className?: string;
}

export function FormField({
  label,
  description,
  error,
  required = false,
  htmlFor,
  children,
  className,
}: FormFieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const classes = ["ep-form-field", error && "ep-form-field--invalid", className].filter(Boolean).join(" ");

  const child = typeof children === "function" ? children({ id }) : children;

  return (
    <div className={classes}>
      {label && (
        <label className="ep-form-field__label" htmlFor={id}>
          {label}
          {required && <span className="ep-form-field__required" aria-hidden="true"> *</span>}
        </label>
      )}
      <div className="ep-form-field__control">{child}</div>
      {(description || error) && (
        <div className={`ep-form-field__hint${error ? " ep-form-field__hint--error" : ""}`}>
          {error ?? description}
        </div>
      )}
    </div>
  );
}
