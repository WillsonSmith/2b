import { ConfirmDialog } from "../../composites/ConfirmDialog.tsx";
import { basename } from "./pathUtils.ts";

interface DeleteConfirmDialogProps {
  path: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({ path, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={path !== null}
      title="Delete file"
      message={
        <>
          <div>
            Delete <strong>{path ? basename(path) : ""}</strong>?
          </div>
          <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 12 }}>
            This cannot be undone.
          </div>
        </>
      }
      confirmLabel="Delete"
      cancelLabel="Cancel"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
