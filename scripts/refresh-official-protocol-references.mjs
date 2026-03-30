import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectOfficialReferenceLinks,
  extractOfficialReferenceSummary,
  pageIdFromUrl,
  prettifyOfficialHtml,
} from "../tooling/protocol/official-reference-cache.js";
import { getOfficialReferenceCachePolicy, listOfficialReferenceSources } from "../tooling/protocol/official-reference.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultOutDir = join(repoRoot, ".local-reference", "agda-protocol");

function parseArgs(argv) {
  let outDir = defaultOutDir;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out-dir" && argv[index + 1]) {
      outDir = resolve(argv[index + 1]);
      index += 1;
    }
  }

  return { outDir };
}

function appendUnique(target, values) {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

async function fetchPage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

function writePageArtifacts(outDir, page, html, text) {
  const pageDir = join(outDir, "pages", page.pageId);
  mkdirSync(pageDir, { recursive: true });

  const rawHtmlPath = join("pages", page.pageId, "raw.html");
  const prettyHtmlPath = join("pages", page.pageId, "pretty.html");
  const contentTextPath = join("pages", page.pageId, "content.txt");
  const metadataPathRelative = join("pages", page.pageId, "page.json");

  writeFileSync(join(outDir, rawHtmlPath), html, "utf8");
  writeFileSync(join(outDir, prettyHtmlPath), prettifyOfficialHtml(html), "utf8");
  writeFileSync(join(outDir, contentTextPath), `${text}\n`, "utf8");
  writeFileSync(
    join(outDir, metadataPathRelative),
    JSON.stringify(
      {
        pageId: page.pageId,
        url: page.url,
        depth: page.depth,
        seedIds: page.seedIds,
        title: page.title,
        headings: page.headings,
        links: page.links,
      },
      null,
      2,
    ),
    "utf8",
  );

  page.artifacts = {
    rawHtml: rawHtmlPath,
    prettyHtml: prettyHtmlPath,
    contentText: contentTextPath,
    metadata: metadataPathRelative,
  };
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  const sources = listOfficialReferenceSources();
  const cachePolicy = getOfficialReferenceCachePolicy();

  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });

  const queued = new Map();
  for (const source of sources) {
    queued.set(source.url, {
      seedIds: [source.id],
      url: source.url,
      depth: 0,
      allowCrawl: source.crawl,
    });
  }

  const pages = new Map();

  while (queued.size > 0 && pages.size < cachePolicy.maxPages) {
    const [url, nextPage] = queued.entries().next().value;
    queued.delete(url);

    if (pages.has(url)) {
      appendUnique(pages.get(url).seedIds, nextPage.seedIds);
      continue;
    }

    const html = await fetchPage(url);
    const summary = extractOfficialReferenceSummary(url, html);
    const links =
      nextPage.allowCrawl && nextPage.depth < cachePolicy.maxDepth
        ? collectOfficialReferenceLinks(url, html, cachePolicy)
        : [];

    const page = {
      pageId: summary.pageId,
      url,
      depth: nextPage.depth,
      seedIds: [...nextPage.seedIds].sort(),
      title: summary.title,
      headings: summary.headings,
      links,
      artifacts: {
        rawHtml: "",
        prettyHtml: "",
        contentText: "",
        metadata: "",
      },
    };

    writePageArtifacts(outDir, page, html, summary.text);
    pages.set(url, page);

    for (const link of links) {
      const existingPage = pages.get(link);
      if (existingPage) {
        appendUnique(existingPage.seedIds, nextPage.seedIds);
        continue;
      }

      const existingQueued = queued.get(link);
      if (existingQueued) {
        appendUnique(existingQueued.seedIds, nextPage.seedIds);
        existingQueued.allowCrawl = existingQueued.allowCrawl || nextPage.allowCrawl;
        continue;
      }

      queued.set(link, {
        url: link,
        depth: nextPage.depth + 1,
        seedIds: [...nextPage.seedIds],
        allowCrawl: nextPage.allowCrawl,
      });
    }
  }

  const pageList = [...pages.values()].sort((left, right) => left.pageId.localeCompare(right.pageId));
  const searchIndex = pageList.map((page) => ({
    pageId: page.pageId,
    url: page.url,
    title: page.title,
    headings: page.headings,
    seedIds: page.seedIds,
    textPath: page.artifacts.contentText,
  }));

  const concatenatedText = pageList
    .map((page) =>
      [
        `# ${page.title}`,
        `Page ID: ${page.pageId}`,
        `URL: ${page.url}`,
        "",
        page.headings.map((heading) => `- ${heading}`).join("\n"),
        "",
        readFileSync(join(outDir, page.artifacts.contentText), "utf8").trim(),
      ]
        .filter((part) => part.length > 0)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  const manifest = {
    fetchedAt: new Date().toISOString(),
    outDir,
    cachePolicy,
    sourceCount: sources.length,
    pageCount: pageList.length,
    sources: sources.map((source) => ({
      id: source.id,
      url: source.url,
      slug: source.slug,
      description: source.description,
      crawl: source.crawl,
      tags: source.tags,
      pageId: pageIdFromUrl(source.url),
    })),
    pages: pageList,
  };

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(join(outDir, "search-index.json"), JSON.stringify(searchIndex, null, 2), "utf8");
  writeFileSync(join(outDir, "all-content.txt"), `${concatenatedText}\n`, "utf8");
  console.log(`Refreshed ${pageList.length} official Agda reference page(s) into ${outDir}`);
}

await main();
