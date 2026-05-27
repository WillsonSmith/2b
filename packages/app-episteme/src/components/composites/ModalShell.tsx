import { useEffect, useCallback } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../primitives/IconButton.tsx";
import { Icon } from "../primitives/Icon.tsx";

interface ModalShellProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  className?: string;
}

export function ModalShell({
  open,
  onClose,
  title,
  children,
  footer,
  width,
  closeOnBackdrop = true,
  closeOnEsc = true,
  className,
}: ModalShellProps) {
  useEffect(() => {
    if (!open || !closeOnEsc || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, closeOnEsc, onClose]);

  const handleOverlayClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!closeOnBackdrop || !onClose) return;
      if (e.target === e.currentTarget) onClose();
    },
    [closeOnBackdrop, onClose],
  );

  if (!open) return null;

  const surfaceStyle: CSSProperties | undefined = width ? { width } : undefined;
  const classes = ["ep-modal", className].filter(Boolean).join(" ");

  return (
    <div className="ep-modal__overlay" onClick={handleOverlayClick} role="presentation">
      <div className={classes} role="dialog" aria-modal="true" style={surfaceStyle}>
        {(title || onClose) && (
          <div className="ep-modal__header">
            {title && <div className="ep-modal__title">{title}</div>}
            {onClose && (
              <IconButton
                icon={<Icon icon={X} size="sm" />}
                aria-label="Close"
                size="sm"
                onClick={onClose}
                className="ep-modal__close"
              />
            )}
          </div>
        )}
        <div className="ep-modal__body">{children}</div>
        {footer && <div className="ep-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
