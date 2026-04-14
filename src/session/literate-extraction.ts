// MIT License — see LICENSE
//
// Literate Agda code extraction.
//
// Extracts Agda code blocks from literate source files, stripping
// the prose wrapper. Each format uses its own delimiter convention:
//
//   .lagda / .lagda.tex  — \begin{code} … \end{code}
//   .lagda.md            — ```agda … ```
//   .lagda.typ           — ```agda … ```
//   .lagda.rst           — indented blocks after :: directive
//   .lagda.org           — #+begin_src agda2 … #+end_src
//   .lagda.tree          — \agda{…} blocks

/** A single extracted code block with its source line range. */
export interface CodeBlock {
  /** 1-indexed start line in the original file. */
  startLine: number;
  /** 1-indexed end line (inclusive) in the original file. */
  endLine: number;
  /** The extracted code lines (no delimiter lines). */
  code: string;
}

export interface ExtractionResult {
  /** The detected literate format, or null if not a literate file. */
  format: LiterateFormat | null;
  /** Extracted code blocks. */
  blocks: CodeBlock[];
  /** All code concatenated with blank-line separators. */
  code: string;
}

export type LiterateFormat =
  | "latex"
  | "markdown"
  | "rst"
  | "org"
  | "tree"
  | "typst";

/**
 * Detect the literate format from a filename.
 * Returns null for plain `.agda` files.
 */
export function detectLiterateFormat(filename: string): LiterateFormat | null {
  if (filename.endsWith(".lagda.md")) return "markdown";
  if (filename.endsWith(".lagda.typ")) return "typst";
  if (filename.endsWith(".lagda.rst")) return "rst";
  if (filename.endsWith(".lagda.org")) return "org";
  if (filename.endsWith(".lagda.tree")) return "tree";
  if (filename.endsWith(".lagda.tex")) return "latex";
  if (filename.endsWith(".lagda")) return "latex";
  return null;
}

/**
 * Extract code blocks from a literate Agda source file.
 * Returns the original content unchanged for plain `.agda` files.
 */
export function extractLiterateCode(
  filename: string,
  content: string,
): ExtractionResult {
  const format = detectLiterateFormat(filename);
  if (!format) {
    return {
      format: null,
      blocks: [{
        startLine: 1,
        endLine: content.split("\n").length,
        code: content,
      }],
      code: content,
    };
  }

  const lines = content.split("\n");
  let blocks: CodeBlock[];

  switch (format) {
    case "latex":
      blocks = extractLatexBlocks(lines);
      break;
    case "markdown":
    case "typst":
      blocks = extractFencedBlocks(lines);
      break;
    case "rst":
      blocks = extractRstBlocks(lines);
      break;
    case "org":
      blocks = extractOrgBlocks(lines);
      break;
    case "tree":
      blocks = extractTreeBlocks(lines);
      break;
  }

  const code = blocks.map((b) => b.code).join("\n\n");
  return { format, blocks, code };
}

// ── Format-specific extractors ──────────────────────────────────────

function extractLatexBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inBlock && trimmed === "\\begin{code}") {
      inBlock = true;
      startLine = i + 2; // 1-indexed, next line after \begin{code}
      codeLines = [];
    } else if (inBlock && trimmed === "\\end{code}") {
      blocks.push({
        startLine,
        endLine: i, // line before \end{code}
        code: codeLines.join("\n"),
      });
      inBlock = false;
    } else if (inBlock) {
      codeLines.push(lines[i]);
    }
  }

  return blocks;
}

function extractFencedBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inBlock && /^```+\s*agda\s*$/i.test(trimmed)) {
      inBlock = true;
      startLine = i + 2; // 1-indexed, next line after ```agda
      codeLines = [];
    } else if (inBlock && /^```+\s*$/.test(trimmed)) {
      blocks.push({
        startLine,
        endLine: i, // line before closing ```
        code: codeLines.join("\n"),
      });
      inBlock = false;
    } else if (inBlock) {
      codeLines.push(lines[i]);
    }
  }

  return blocks;
}

function extractRstBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];
  let sawDirective = false;
  let blankAfterDirective = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inBlock && !sawDirective && trimmed === "::") {
      sawDirective = true;
      blankAfterDirective = false;
      continue;
    }

    if (sawDirective && !inBlock) {
      if (trimmed === "") {
        blankAfterDirective = true;
        continue;
      }
      if (blankAfterDirective && /^\s{2,}/.test(line)) {
        // First indented line after blank line after ::
        inBlock = true;
        startLine = i + 1; // 1-indexed
        codeLines = [line];
        continue;
      }
      // Non-indented, non-blank line after :: — not a code block
      sawDirective = false;
      blankAfterDirective = false;
    }

    if (inBlock) {
      // RST code blocks end at the first non-blank, non-indented line
      if (trimmed === "") {
        codeLines.push(line);
      } else if (/^\s{2,}/.test(line)) {
        codeLines.push(line);
      } else {
        // End of indented block
        // Trim trailing blank lines from the code block
        while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === "") {
          codeLines.pop();
        }
        blocks.push({
          startLine,
          endLine: startLine + codeLines.length - 1,
          code: codeLines.join("\n"),
        });
        inBlock = false;
        codeLines = [];
        // Check if current line starts a new directive
        if (trimmed === "::") {
          sawDirective = true;
          blankAfterDirective = false;
        }
      }
    }
  }

  // Handle block at end of file
  if (inBlock && codeLines.length > 0) {
    // Trim trailing blank lines
    while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === "") {
      codeLines.pop();
    }
    if (codeLines.length > 0) {
      blocks.push({
        startLine,
        endLine: startLine + codeLines.length - 1,
        code: codeLines.join("\n"),
      });
    }
  }

  return blocks;
}

function extractOrgBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim().toLowerCase();
    if (!inBlock && trimmed === "#+begin_src agda2") {
      inBlock = true;
      startLine = i + 2; // 1-indexed, next line after #+begin_src
      codeLines = [];
    } else if (inBlock && trimmed === "#+end_src") {
      blocks.push({
        startLine,
        endLine: i, // line before #+end_src
        code: codeLines.join("\n"),
      });
      inBlock = false;
    } else if (inBlock) {
      codeLines.push(lines[i]);
    }
  }

  return blocks;
}

function extractTreeBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  // \agda{...} can span multiple lines. We need to track brace depth.
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlock) {
      const agdaIdx = line.indexOf("\\agda{");
      if (agdaIdx !== -1) {
        inBlock = true;
        // Content after \agda{ on the same line
        const afterOpen = line.slice(agdaIdx + 6);
        braceDepth = 1;

        // Count braces in the rest of the opening line
        for (const ch of afterOpen) {
          if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
          if (braceDepth === 0) break;
        }

        if (braceDepth === 0) {
          // Single-line \agda{...} — extract content between { and last }
          const content = afterOpen.slice(0, afterOpen.lastIndexOf("}"));
          if (content.trim()) {
            blocks.push({
              startLine: i + 1,
              endLine: i + 1,
              code: content,
            });
          }
          inBlock = false;
        } else {
          // Multi-line — content after \agda{ on opening line
          const firstLineContent = afterOpen.trim();
          if (firstLineContent) {
            // Code starts on the same line as \agda{
            startLine = i + 1;
            codeLines = [afterOpen];
          } else {
            // Code starts on the next line
            startLine = i + 2;
            codeLines = [];
          }
        }
      }
    } else {
      // Inside a multi-line \agda{...} block
      // Check for closing brace
      let foundEnd = false;
      for (let j = 0; j < line.length; j++) {
        if (line[j] === "{") braceDepth++;
        else if (line[j] === "}") {
          braceDepth--;
          if (braceDepth === 0) {
            // Everything before the closing } on this line is code
            const lastCodePart = line.slice(0, j);
            if (lastCodePart.trim()) {
              codeLines.push(lastCodePart);
            }
            foundEnd = true;
            break;
          }
        }
      }

      if (foundEnd) {
        blocks.push({
          startLine,
          endLine: i + 1,
          code: codeLines.join("\n"),
        });
        inBlock = false;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
    }
  }

  return blocks;
}
