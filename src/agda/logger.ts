// MIT License — see LICENSE
//
// Zero-cost-when-off debug logging for the Agda MCP server.
// Enable with AGDA_MCP_DEBUG=1 environment variable.
// Output goes to stderr so it doesn't interfere with MCP JSON on stdout.

const DEBUG = process.env.AGDA_MCP_DEBUG === "1";

function formatData(data?: unknown): string {
  if (data === undefined) return "";
  try {
    return " " + JSON.stringify(data);
  } catch {
    return " [unserializable]";
  }
}

/** Debug logger — all methods are no-ops unless AGDA_MCP_DEBUG=1. */
export const logger = {
  /** Fine-grained trace (commands sent, responses received). */
  trace: DEBUG
    ? (msg: string, data?: unknown) =>
        process.stderr.write(`[agda-mcp] ${msg}${formatData(data)}\n`)
    : (_msg: string, _data?: unknown): void => {},

  /** Warnings (non-fatal issues, skipped lines, parse failures). */
  warn: (msg: string, data?: unknown) =>
    process.stderr.write(`[agda-mcp] WARN: ${msg}${formatData(data)}\n`),
};
