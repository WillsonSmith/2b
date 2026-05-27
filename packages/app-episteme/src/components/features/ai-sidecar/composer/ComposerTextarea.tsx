import type { ChangeEvent, KeyboardEvent, Ref } from "react";
import { Textarea } from "../../../primitives/Textarea.tsx";

interface ComposerTextareaProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  placeholder: string;
  disabled?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function ComposerTextarea({
  value,
  onChange,
  onKeyDown,
  onBlur,
  placeholder,
  disabled,
  textareaRef,
}: ComposerTextareaProps) {
  return (
    <Textarea
      ref={textareaRef}
      className="ep-sidecar__composer-textarea"
      value={value}
      placeholder={placeholder}
      rows={2}
      autosize
      maxAutosizeRows={10}
      disabled={disabled}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}
