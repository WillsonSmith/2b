import { sectionHash } from "../../../features/tocHash.ts";

export interface HeadingData {
  level: number;
  text: string;
  contentHash: string;
}

export function extractHeadingData(markdown: string): HeadingData[] {
  const lines = markdown.split("\n");
  const result: HeadingData[] = [];
  let current: { level: number; text: string } | null = null;
  let content = "";

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) {
      if (current) {
        result.push({ ...current, contentHash: sectionHash(current.text, content) });
      }
      current = { level: m[1]!.length, text: m[2]!.trim() };
      content = "";
    } else if (current && line.trim()) {
      content += line + " ";
    }
  }
  if (current) {
    result.push({ ...current, contentHash: sectionHash(current.text, content) });
  }
  return result;
}

export function scrollToHeading(text: string): void {
  const headings = document.querySelectorAll(
    ".tiptap h1, .tiptap h2, .tiptap h3, .tiptap h4, .tiptap h5, .tiptap h6",
  );
  for (const el of headings) {
    if (el.textContent?.trim() === text) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    }
  }
}
