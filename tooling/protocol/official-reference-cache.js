import { z } from "zod";

export const officialReferenceCachePolicySchema = z.object({
  maxDepth: z.int().min(0),
  maxPages: z.int().min(1),
  allowedOrigins: z.array(z.string().url()).min(1),
  includePathPrefixes: z.array(z.string().min(1)).min(1),
  excludePathPrefixes: z.array(z.string().min(1)).default([]),
  includeExtensions: z.array(z.string().min(1)).min(1),
});

export const officialReferenceSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  slug: z.string().min(1),
  description: z.string().min(1),
  crawl: z.boolean().default(true),
  tags: z.array(z.string().min(1)).default([]),
});

export const officialReferenceSourcesSchema = z.object({
  cachePolicy: officialReferenceCachePolicySchema,
  sources: z.array(officialReferenceSourceSchema),
});

const COMMON_HTML_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

export function pageIdFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  const withoutExtension = pathname.replace(/\.html?$/i, "");
  const trimmed = withoutExtension.replace(/^\/+/, "");
  const base = trimmed.length > 0 ? trimmed : "index";
  return base.replace(/[\/\\]+/g, "__");
}

export function decodeHtmlEntities(input) {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const rawValue = isHex ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(rawValue, isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return COMMON_HTML_ENTITIES[entity] ?? match;
  });
}

function stripMarkupToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script(?:\s[^>]*)?>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style(?:\s[^>]*)?>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|nav|aside|header|footer|pre|code|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function extractOfficialReferenceSummary(rawUrl, html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const headings = Array.from(
    html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi),
    (match) => decodeHtmlEntities(stripMarkupToText(match[1]).replace(/\s+/g, " ").trim()),
  ).filter((heading) => heading.length > 0);
  const text = decodeHtmlEntities(stripMarkupToText(html))
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    pageId: pageIdFromUrl(rawUrl),
    title: decodeHtmlEntities(titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? pageIdFromUrl(rawUrl)),
    headings,
    text,
  };
}

export function prettifyOfficialHtml(html) {
  return html
    .replace(/\r\n/g, "\n")
    .replace(/>\s*</g, ">\n<")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

export function collectOfficialReferenceLinks(baseUrl, html, policy) {
  const base = new URL(baseUrl);
  const links = new Set();
  const allowedOrigins = new Set(policy.allowedOrigins);

  for (const match of html.matchAll(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const href = match[1] ?? match[2] ?? match[3];
    if (!href || href.startsWith("#")) {
      continue;
    }

    let resolved;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }

    resolved.hash = "";
    if (!allowedOrigins.has(resolved.origin)) {
      continue;
    }

    const pathname = resolved.pathname;
    if (!policy.includePathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
      continue;
    }

    if (policy.excludePathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
      continue;
    }

    if (!policy.includeExtensions.some((extension) => pathname.endsWith(extension))) {
      continue;
    }

    links.add(resolved.toString());
  }

  return [...links].sort();
}
