import { useEffect } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Intercepts clipboard pastes that contain an image, reads the blob as base64,
 * and forwards it via `onImagePaste`. The default paste path is preempted so
 * the image isn't dropped into the document as a binary URL.
 */
export function useImagePaste(
  editor: Editor | null,
  onImagePaste?: (base64: string, mimeType: string, filename: string) => void,
): void {
  useEffect(() => {
    if (!editor || !onImagePaste) return;
    const dom = editor.view.dom;

    const handlePaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      const imageFile = files.find((f) => f.type.startsWith("image/"));
      if (!imageFile) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        onImagePaste(base64, imageFile.type, imageFile.name || "pasted-image.png");
      };
      reader.readAsDataURL(imageFile);
    };

    dom.addEventListener("paste", handlePaste);
    return () => dom.removeEventListener("paste", handlePaste);
  }, [editor, onImagePaste]);
}
