/**
 * Removes `<think>...</think>` blocks from a string.
 *
 * @param inputString - The string to process.
 * @param flexibleMode - When `false` (default), only removes complete
 *   `<think>...</think>` pairs. When `true`, also removes content that
 *   appears at the very start of the string before the first `</think>`,
 *   even if no opening `<think>` tag is present (i.e. the opening tag was
 *   consumed by a previous chunk). Callers using `flexibleMode` should
 *   ensure that any leading text before the first `</think>` is always
 *   think-block content — the regex will strip it unconditionally.
 */
export function removeThinkTags(inputString: string, flexibleMode = false): string {
  let regex;

  if (flexibleMode) {
    // Matches either:
    //   • content at the start of the string (no opening tag) up to </think>
    //   • a complete <think>...</think> pair anywhere in the string
    regex = /(?:^[\s\S]*?<\/think>|<think>[\s\S]*?<\/think>)/g;
  } else {
    // Strict mode: requires both opening and closing tags
    regex = /<think>[\s\S]*?<\/think>/g;
  }

  return inputString.replace(regex, "").trim();
}
