import { braveSearchJobUrls, capJobUrls } from "./brave";
import { firecrawlExtractJobs } from "./firecrawl";
import type { NormalizedJob, ScrapeQuery } from "./types";

/**
 * Top-level scrape orchestrator (Brave → Firecrawl pipeline).
 *
 * Stage 1 — Discovery (Brave Search API):
 *   For each ScrapeQuery, hit Brave with a `site:` filter across known job
 *   board domains. Returns ~20 URLs per query, deduped across queries.
 *
 * Stage 2 — Extraction (Firecrawl /v1/scrape with JSON Schema):
 *   For each unique URL, Firecrawl scrapes the page and uses an LLM to
 *   extract structured fields (title, company, location, salary, description,
 *   posted_date) into a NormalizedJob.
 *
 * Stage 3 — Dedupe:
 *   Across all extracted jobs, dedupe again on (title|company|location)
 *   in case the same posting was found via multiple Brave queries.
 */
export async function scrapeJobsForUser(
  queries: ScrapeQuery[],
): Promise<NormalizedJob[]> {
  // ---- Stage 1: discovery ----
  const urlSet = new Set<string>();
  for (const q of queries) {
    const urls = await braveSearchJobUrls(q);
    for (const url of urls) urlSet.add(url);
  }

  if (urlSet.size === 0) {
    console.warn("[scraper] Brave returned 0 URLs. Check BRAVE_API_KEY or queries.");
    return [];
  }

  console.log(`[scraper] Brave discovered ${urlSet.size} unique URLs`);

  // Apply global cap before extraction so we don't firehose Firecrawl
  // (rate limits + per-scrape cost). See MAX_URLS_PER_SCAN in brave.ts.
  const cappedUrls = capJobUrls([...urlSet]);

  // ---- Stage 2: extraction ----
  const jobs = await firecrawlExtractJobs(cappedUrls, 5);

  // ---- Stage 3: cross-source dedupe ----
  const seen = new Set<string>();
  const deduped: NormalizedJob[] = [];
  for (const job of jobs) {
    if (seen.has(job.dedupe_key)) continue;
    seen.add(job.dedupe_key);
    deduped.push(job);
  }

  console.log(
    `[scraper] Firecrawl extracted ${jobs.length}, ${deduped.length} after dedupe`,
  );
  return deduped;
}

export type { NormalizedJob, ScrapeQuery };
