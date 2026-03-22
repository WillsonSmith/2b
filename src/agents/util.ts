export function removeThinkTags(inputString: string, flexibleMode = false) {
  let regex;

  if (flexibleMode) {
    // Matches from the start of the string (^) OR a literal <think>
    // up until the first </think>
    regex = /(?:^|<think>)[\s\S]*?<\/think>/g;
  } else {
    // Strict mode: requires both tags
    regex = /<think>[\s\S]*?<\/think>/g;
  }

  return inputString.replace(regex, "").trim();
}
