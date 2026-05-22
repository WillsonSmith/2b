export type StyleCategory = "filler" | "cliche" | "redundancy";

export interface StyleRule {
  /** Compiled per-match regex (must include `g` flag and word boundaries where appropriate). */
  pattern: RegExp;
  category: StyleCategory;
  message: string;
}

function wordSet(words: string[], message: string, category: StyleCategory): StyleRule[] {
  return words.map((w) => ({
    pattern: new RegExp(`\\b${escapeRegex(w)}\\b`, "gi"),
    category,
    message: message.replace("{w}", w),
  }));
}

function phraseSet(phrases: string[], message: string, category: StyleCategory): StyleRule[] {
  return phrases.map((p) => ({
    // Allow flexible whitespace between phrase words and match case-insensitively.
    pattern: new RegExp(escapeRegex(p).replace(/\s+/g, "\\s+"), "gi"),
    category,
    message: message.replace("{p}", p),
  }));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Fillers ───────────────────────────────────────────────────────────────────
// Words that almost never add meaning. Curated, conservative — flagging "that"
// indiscriminately produces too much noise, so we leave it off the default list.
const FILLER_WORDS = [
  "very",
  "just",
  "really",
  "quite",
  "actually",
  "basically",
  "literally",
  "definitely",
  "essentially",
  "totally",
  "absolutely",
  "simply",
];

// ── Clichés ───────────────────────────────────────────────────────────────────
// Compact starter list — phrases recognized as worn-out across most prose.
const CLICHE_PHRASES = [
  "at the end of the day",
  "in this day and age",
  "needless to say",
  "first and foremost",
  "last but not least",
  "few and far between",
  "tip of the iceberg",
  "think outside the box",
  "low-hanging fruit",
  "move the needle",
  "circle back",
  "boil the ocean",
  "synergy",
  "paradigm shift",
  "game changer",
  "at the heart of",
  "in my own personal opinion",
  "only time will tell",
  "when all is said and done",
  "in a nutshell",
  "the fact of the matter is",
  "it goes without saying",
  "for all intents and purposes",
  "to make a long story short",
  "the bottom line is",
];

// ── Redundancies ─────────────────────────────────────────────────────────────
// Pleonasms — paired words where one already implies the other.
const REDUNDANCY_PHRASES = [
  "ATM machine",
  "PIN number",
  "free gift",
  "advance planning",
  "advance warning",
  "advance notice",
  "added bonus",
  "completely eliminate",
  "end result",
  "final outcome",
  "future plans",
  "past history",
  "past experience",
  "personal opinion",
  "unexpected surprise",
  "exact same",
  "absolutely essential",
  "basic fundamentals",
  "brief moment",
  "close proximity",
  "each and every",
  "first and foremost",
  "join together",
  "new innovation",
  "null and void",
  "revert back",
  "true fact",
  "twelve noon",
  "twelve midnight",
];

export const STYLE_RULES: StyleRule[] = [
  ...wordSet(FILLER_WORDS, "Filler — “{w}” rarely adds meaning. Consider removing.", "filler"),
  ...phraseSet(CLICHE_PHRASES, "Cliché — “{p}” is worn out. Rephrase for impact.", "cliche"),
  ...phraseSet(REDUNDANCY_PHRASES, "Redundancy — “{p}” repeats itself. Trim.", "redundancy"),
];

export interface StyleIssue {
  from: number; // character offset in input text
  to: number;
  category: StyleCategory;
  message: string;
  matched: string;
}

/**
 * Scan plain text for style-rule matches. Returns issues sorted by start
 * position. Overlapping matches in the same category are deduplicated by
 * preferring the earlier longer match.
 */
export function scanText(
  text: string,
  enabledCategories: Record<StyleCategory, boolean>,
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (const rule of STYLE_RULES) {
    if (!enabledCategories[rule.category]) continue;
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      issues.push({
        from: m.index,
        to: m.index + m[0].length,
        category: rule.category,
        message: rule.message,
        matched: m[0],
      });
      if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
    }
  }
  issues.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  // Drop overlapping matches (keep the first, which is the longest at that start).
  const out: StyleIssue[] = [];
  let lastEnd = -1;
  for (const issue of issues) {
    if (issue.from >= lastEnd) {
      out.push(issue);
      lastEnd = issue.to;
    }
  }
  return out;
}
