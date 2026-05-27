import type { ReactNode } from "react";
import { Button } from "../primitives/Button.tsx";
import { ModalShell } from "./ModalShell.tsx";

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      title={title}
      width="min(420px, 90vw)"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "solid"}
            size="sm"
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ep-confirm-dialog__message">{message}</div>
    </ModalShell>
  );
}
