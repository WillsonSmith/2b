// Starter style-guide sections, bundled with the app as imported text.
// Grow the library by adding a `.md` file and registering it below — no other
// code changes needed. Bodies follow the authoring guidance in the plan:
// single concern, 80–250 words, imperative voice, no "you are…" preamble.
import conciseVoice from "./concise-voice.md" with { type: "text" };
import plainLanguage from "./plain-language.md" with { type: "text" };
import britishEnglish from "./british-english.md" with { type: "text" };
import academicCitation from "./academic-citation.md" with { type: "text" };
import coderVoice from "./coder-voice.md" with { type: "text" };
import fictionPov from "./fiction-pov.md" with { type: "text" };
import emDashDiscipline from "./em-dash-discipline.md" with { type: "text" };

export interface LibrarySection {
  slug: string;
  title: string;
  /** First ~140 chars of the body, for the picker UI. */
  preview: string;
  body: string;
}

const PREVIEW_CHARS = 140;

function preview(body: string): string {
  const flat = body.trim().replace(/\s+/g, " ");
  return flat.length > PREVIEW_CHARS ? flat.slice(0, PREVIEW_CHARS).trimEnd() + "…" : flat;
}

function entry(slug: string, title: string, body: string): LibrarySection {
  return { slug, title, body: body.trim(), preview: preview(body) };
}

export const LIBRARY: readonly LibrarySection[] = [
  entry("concise-voice", "Concise voice", conciseVoice),
  entry("plain-language", "Plain language", plainLanguage),
  entry("british-english", "British English", britishEnglish),
  entry("academic-citation", "Academic & cited", academicCitation),
  entry("coder-voice", "Technical / coder voice", coderVoice),
  entry("fiction-pov", "Fiction POV", fictionPov),
  entry("em-dash-discipline", "Em-dash discipline", emDashDiscipline),
];

export function findLibrarySection(slug: string): LibrarySection | undefined {
  return LIBRARY.find((s) => s.slug === slug);
}
