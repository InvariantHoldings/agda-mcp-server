import { TextDecoder } from "node:util";

/** A protocol boundary observed on Agda's stdout stream. */
export type StdoutFrameEvent =
  | { type: "prompt"; value: "JSON> " | "Agda2> " }
  | { type: "json"; text: string }
  | { type: "raw"; text: string }
  | { type: "malformed"; text: string };

const PROMPTS = ["JSON> ", "Agda2> "] as const;

/**
 * Incremental framing for Agda interaction output.
 *
 * JSON responses are newline-terminated, while the prompt is a flushed,
 * non-newline-terminated token. The scanner therefore treats a balanced JSON
 * value as one record and only recognizes a prompt at the stream boundary;
 * prompt-looking text inside a JSON string is never inspected. TextDecoder's
 * fatal streaming mode rejects malformed UTF-8 before any prompt can seal a
 * frame.
 */
export class AgdaStdoutFramer {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";

  push(chunk: Buffer): StdoutFrameEvent[] {
    let text: string;
    try {
      text = this.decoder.decode(chunk, { stream: true });
    } catch {
      this.reset();
      return [{ type: "malformed", text: "Invalid UTF-8 in Agda stdout" }];
    }
    this.buffer += text;
    return this.drain();
  }

  /** Flush decoder state and report an incomplete trailing record as malformed. */
  finish(): StdoutFrameEvent[] {
    let text = "";
    try {
      text = this.decoder.decode();
    } catch {
      this.decoder = new TextDecoder("utf-8", { fatal: true });
      this.buffer = "";
      return [{ type: "malformed", text: "Invalid UTF-8 in Agda stdout" }];
    }
    this.buffer += text;
    const events = this.drain();
    if (this.buffer.length > 0) {
      events.push({ type: "malformed", text: this.buffer });
      this.buffer = "";
    }
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    return events;
  }

  reset(): void {
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.buffer = "";
  }

  private drain(): StdoutFrameEvent[] {
    const events: StdoutFrameEvent[] = [];
    while (this.buffer.length > 0) {
      if (this.buffer[0] === "\n" || this.buffer[0] === "\r") {
        this.buffer = this.buffer.slice(1);
        continue;
      }

      const prompt = this.promptAtBoundary();
      if (prompt !== null) {
        this.buffer = this.buffer.slice(prompt.length);
        events.push({ type: "prompt", value: prompt });
        continue;
      }
      if (this.isPartialPrompt()) break;

      const first = this.buffer[0];
      if (first === "{" || first === "[") {
        const end = completeJsonValue(this.buffer);
        if (end === null) break;
        const candidate = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end);
        try {
          JSON.parse(candidate);
          events.push({ type: "json", text: candidate });
        } catch {
          events.push({ type: "malformed", text: candidate });
        }
        continue;
      }

      const newline = this.buffer.search(/[\r\n]/u);
      if (newline === -1) break;
      const raw = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (raw.length > 0) events.push({ type: "raw", text: raw });
    }
    return events;
  }

  private promptAtBoundary(): (typeof PROMPTS)[number] | null {
    for (const prompt of PROMPTS) {
      if (this.buffer.startsWith(prompt)) return prompt;
    }
    return null;
  }

  private isPartialPrompt(): boolean {
    return PROMPTS.some((prompt) =>
      prompt.startsWith(this.buffer) && this.buffer.length < prompt.length,
    );
  }
}

/** Return the exclusive end of a complete root JSON object/array. */
function completeJsonValue(input: string): number | null {
  const opener = input[0];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opener) {
      depth += 1;
    } else if (character === closer) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}
