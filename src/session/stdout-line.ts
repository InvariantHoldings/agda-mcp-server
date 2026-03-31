// MIT License — see LICENSE
//
// Helpers for classifying Agda stdout lines coming from --interaction-json.

const PROMPT_PREFIXES = ["JSON> ", "Agda2> "];

export interface ParsedStdoutLine {
  jsonText?: string;
  noticeText?: string;
}

function stripPromptPrefix(line: string): string {
  for (const prefix of PROMPT_PREFIXES) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }

  if (line === "JSON>" || line === "Agda2>") {
    return "";
  }

  return line;
}

export function parseAgdaStdoutLine(rawLine: string): ParsedStdoutLine {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return {};
  }

  const withoutPrompt = stripPromptPrefix(trimmed);
  if (!withoutPrompt) {
    return {};
  }

  if (withoutPrompt.startsWith("{") || withoutPrompt.startsWith("[")) {
    return { jsonText: withoutPrompt };
  }

  return { noticeText: withoutPrompt };
}
