import type { ScrapeQuery } from "./types";

/**
 * Brave Search API adapter — discovery layer.
 *
 * Returns a list of job posting URLs across LinkedIn, Indeed, Greenhouse,
 * Lever, Wellfound, Ashby, etc. The actual job fields (title, company,
 * description, salary) are extracted in the next stage by Firecrawl.
 *
 * Strategy: one Brave query per (role, site) combo. This is more reliable
 * than `(site:a OR site:b ...)` because Brave's parenthesized OR over
 * multiple site: filters tends to return empty result sets. With 6 sites
 * and 1-3 roles, we hit ~6-18 queries per refresh — well within the
 * 2000/mo free tier.
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search
 */

const JOB_SITES = [
  "linkedin.com/jobs/view",
  "indeed.com/viewjob",
  "boards.greenhouse.io",
  "jobs.lever.co",
  "wellfound.com/jobs",
  "jobs.ashbyhq.com",
];

interface BraveResult {
  url?: string;
  title?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
  error?: { message?: string; code?: string };
}

async function braveQuery(q: string, count: number): Promise<string[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) {
    console.warn("[brave] BRAVE_API_KEY not set; skipping discovery");
    return [];
  }

  const params = new URLSearchParams({
    q,
    count: String(Math.min(count, 20)),
    safesearch: "off",
  });

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          "X-Subscription-Token": key,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[brave] HTTP ${res.status} for q="${q}"`,
        text.slice(0, 300),
      );
      return [];
    }

    const data = (await res.json()) as BraveResponse;
    if (data.error) {
      console.error(`[brave] API error for q="${q}"`, data.error);
      return [];
    }

    const results = data.web?.results ?? [];
    const urls = results.map((r) => r.url).filter((u): u is string => !!u);
    console.log(`[brave] q="${q}" → ${urls.length} URLs`);
    return urls;
  } catch (err) {
    console.error(`[brave] fetch threw for q="${q}"`, err);
    return [];
  }
}

/**
 * One Brave query per (role × location × site). Returns deduped URLs that
 * actually look like job postings on one of our target boards.
 */
export async function braveSearchJobUrls(
  query: ScrapeQuery,
): Promise<string[]> {
  const perSiteCount = Math.max(3, Math.floor((query.limit ?? 20) / 3));
  const locationPart = query.location ? ` "${query.location}"` : "";
  const seen = new Set<string>();

  for (const site of JOB_SITES) {
    const q = `"${query.role}"${locationPart} jobs site:${site}`;
    const urls = await braveQuery(q, perSiteCount);
    for (const u of urls) {
      // Be lenient — any URL containing the site fragment counts.
      if (JOB_SITES.some((s) => u.includes(s))) seen.add(u);
    }
  }

  console.log(
    `[brave] role="${query.role}" location="${query.location ?? ""}" → ${seen.size} unique job URLs across ${JOB_SITES.length} sites`,
  );
  return [...seen];
}

/** Map a URL back to its source label for the `jobs.source` column. */
export function detectSourceFromUrl(url: string):
  | "linkedin"
  | "indeed"
  | "greenhouse"
  | "lever"
  | "wellfound"
  | "ashby"
  | "other" {
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("indeed.com")) return "indeed";
  if (url.includes("greenhouse.io")) return "greenhouse";
  if (url.includes("lever.co")) return "lever";
  if (url.includes("wellfound.com")) return "wellfound";
  if (url.includes("ashbyhq.com")) return "ashby";
  return "other";
}
