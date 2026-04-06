import type { JobSource, ScrapeQuery } from "./types";

/**
 * Brave Search API adapter — discovery layer.
 *
 * Returns a list of job posting URLs across various ATS systems
 * (Greenhouse, Lever, Ashby, Workable, etc). The actual job fields
 * (title, company, description, salary) are extracted in the next
 * stage by Firecrawl.
 *
 * Strategy: one Brave query per (role, site) combo. This is more reliable
 * than `(site:a OR site:b ...)` because Brave's parenthesized OR over
 * multiple site: filters tends to return empty result sets. With ~10 sites
 * and 1-3 roles, we hit ~10-30 queries per refresh — well within the
 * 2000/mo free tier.
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search
 */

/**
 * NB: LinkedIn and Indeed are intentionally excluded.
 *  - LinkedIn: Firecrawl explicitly refuses (403 "we do not support this site"),
 *    and direct scraping requires stealth + proxy rotation we don't have.
 *  - Indeed: blocks Google's crawler entirely, so Brave's index is empty.
 *
 * What remains is ATS-hosted job pages, which are publicly indexable and
 * scrape cleanly through Firecrawl. Most real hiring companies post to
 * one of these, and recruiters just cross-post to LinkedIn anyway.
 */
const JOB_SITES = [
  "boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "wellfound.com/jobs",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
  "jobs.jobvite.com",
  "recruitee.com/o",
  "bamboohr.com/jobs",
  "breezy.hr",
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
 * One Brave query per (role × site), with a location-less fallback when the
 * location-scoped query comes back empty. We deliberately do NOT exact-phrase
 * the role: real job titles vary ("Lead, Marketing Data Science", "Senior
 * Marketing Data Scientist", etc.), and exact-phrase matching kills recall.
 */
export async function braveSearchJobUrls(
  query: ScrapeQuery,
): Promise<string[]> {
  const perSiteCount = Math.max(5, Math.floor((query.limit ?? 30) / 2));
  const role = query.role.trim();
  const location = query.location?.trim() ?? "";
  const seen = new Set<string>();

  for (const site of JOB_SITES) {
    // Primary query: role + location (location is the only thing we quote,
    // and only if it's a multi-word string like "New York" or "San Francisco").
    const locPart = location
      ? ` ${location.includes(" ") ? `"${location}"` : location}`
      : "";
    const primary = `${role} jobs${locPart} site:${site}`;
    let urls = await braveQuery(primary, perSiteCount);

    // Fallback: drop the location filter if the location-scoped query is empty.
    // Lots of ATS pages don't surface a city name in their indexable copy.
    if (urls.length === 0 && location) {
      const fallback = `${role} jobs site:${site}`;
      urls = await braveQuery(fallback, perSiteCount);
    }

    for (const u of urls) {
      if (JOB_SITES.some((s) => u.includes(s))) seen.add(u);
    }
  }

  console.log(
    `[brave] role="${role}" location="${location}" → ${seen.size} unique job URLs across ${JOB_SITES.length} sites`,
  );
  return [...seen];
}

/** Map a URL back to its source label for the `jobs.source` column. */
export function detectSourceFromUrl(url: string): JobSource {
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("indeed.com")) return "indeed";
  if (url.includes("greenhouse.io")) return "greenhouse";
  if (url.includes("lever.co")) return "lever";
  if (url.includes("ashbyhq.com")) return "ashby";
  if (url.includes("wellfound.com")) return "wellfound";
  // Newer ATS sources fall under "other" until we widen the DB enum.
  return "other";
}
