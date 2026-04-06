import { scrapeSerpApiGoogleJobs } from "./serpapi";
import type { NormalizedJob, ScrapeQuery } from "./types";

/**
 * Top-level scrape orchestrator.
 *
 * Phase 1 strategy: SerpAPI-first.
 * - Run SerpAPI Google Jobs for each query
 * - (Future) Try Playwright direct scrapes when PLAYWRIGHT_ENABLED=true
 * - Dedupe by (title|company|location)
 */
export async function scrapeJobsForUser(
  queries: ScrapeQuery[],
): Promise<NormalizedJob[]> {
  const all: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const result = await scrapeSerpApiGoogleJobs(q);
    if (result.blocked) {
      console.warn(`[scraper] ${q.role}: SerpAPI blocked or unavailable`);
    }
    for (const job of result.jobs) {
      if (seen.has(job.dedupe_key)) continue;
      seen.add(job.dedupe_key);
      all.push(job);
    }
  }

  return all;
}

export type { NormalizedJob, ScrapeQuery };
