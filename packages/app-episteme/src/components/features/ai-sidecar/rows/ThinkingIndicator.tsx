import { InlineLoading } from "../../../composites/InlineLoading.tsx";

export function ThinkingIndicator() {
  return (
    <div className="ep-sidecar__thinking">
      <InlineLoading>Thinking…</InlineLoading>
    </div>
  );
}
