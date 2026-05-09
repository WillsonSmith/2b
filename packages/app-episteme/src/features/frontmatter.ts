import yaml from "js-yaml";

export type FrontmatterValue = string | number | boolean | string[] | null;
export type FrontmatterFields = Record<string, FrontmatterValue>;

/** Parse existing YAML frontmatter block. Returns yaml content and the body after it. */
export function parseFrontmatter(markdown: string): { yaml: string | null; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    return { yaml: match[1] ?? null, body: match[2] ?? "" };
  }
  return { yaml: null, body: markdown };
}

/** Insert or replace YAML frontmatter at the top of a Markdown document. */
export function injectFrontmatter(markdown: string, yamlContent: string): string {
  const { body } = parseFrontmatter(markdown);
  return `---\n${yamlContent}\n---\n\n${body.trimStart()}`;
}

function normalizeValue(value: unknown): FrontmatterValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString().split("T")[0] ?? "";
  if (Array.isArray(value)) return value.map((v) => (v == null ? "" : String(v)));
  return String(value);
}

/** Parse a YAML frontmatter block into a flat ordered map. Unparseable input returns {}. */
export function parseYamlFields(yamlString: string): FrontmatterFields {
  if (!yamlString.trim()) return {};
  try {
    const parsed = yaml.load(yamlString);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: FrontmatterFields = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[key] = normalizeValue(value);
    }
    return result;
  } catch {
    return {};
  }
}

/** Serialize a flat field map back to a YAML string (no `---` fences). */
export function serializeYamlFields(fields: FrontmatterFields): string {
  if (Object.keys(fields).length === 0) return "";
  return yaml
    .dump(fields, { lineWidth: -1, quotingType: '"', forceQuotes: false, noRefs: true })
    .trimEnd();
}

/** True if the YAML parses to a plain object (i.e. structured editor can render it). */
export function isStructuredYaml(yamlString: string): boolean {
  if (!yamlString.trim()) return true;
  try {
    const parsed = yaml.load(yamlString);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
