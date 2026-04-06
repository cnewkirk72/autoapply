import type { JobSource, ScrapeQuery } from "./types";

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

/**
 * URL-shape filters — only accept URLs that look like individual job detail
 * pages on each ATS. Without this, Brave happily returns careers landing
 * pages, filter/search URLs, and embed widgets (e.g. bamboohr embed2.php),
 * which Firecrawl can't extract and which waste credits + pollute logs.
 *
 * Each regex matches the canonical detail-page shape for that ATS.
 */
const JOB_DETAIL_PATTERNS: RegExp[] = [
  // boards.greenhouse.io/{company}/jobs/{numeric_id}
  /boards\.greenhouse\.io\/[^\/]+\/jobs\/\d+/i,
  // jobs.lever.co/{company}/{uuid}
  /jobs\.lever\.co\/[^\/]+\/[0-9a-f-]{20,}/i,
  // jobs.ashbyhq.com/{company}/{uuid}
  /jobs\.ashbyhq\.com\/[^\/]+\/[0-9a-f-]{20,}/i,
  // wellfound.com/jobs/{numeric_id}-slug or /company/{slug}/jobs/{id}
  /wellfound\.com\/jobs\/\d+/i,
  /wellfound\.com\/company\/[^\/]+\/jobs\/\d+/i,
  // apply.workable.com/{company}/j/{ALPHANUM_ID}
  /apply\.workable\.com\/[^\/]+\/j\/[A-Z0-9]+/i,
  // jobs.smartrecruiters.com/{company}/{numeric_id}-slug
  /jobs\.smartrecruiters\.com\/[^\/]+\/\d{6,}/i,
  // jobs.jobvite.com/{company}/job/{id}
  /jobs\.jobvite\.com\/[^\/]+\/job\/[A-Za-z0-9_-]+/i,
  // {company}.recruitee.com/o/{slug} or recruitee.com/o/{slug}
  /recruitee\.com\/o\/[a-z0-9-]+/i,
  // {company}.bamboohr.com/jobs/view.php?id={id} or /careers/{id}
  /bamboohr\.com\/(jobs\/view\.php\?id=\d+|careers\/\d+)/i,
  // {company}.breezy.hr/p/{uuid-slug}
  /breezy\.hr\/p\/[a-f0-9]{8,}/i,
];

function isJobDetailUrl(url: string): boolean {
  return JOB_DETAIL_PATTERNS.some((re) => re.test(url));
}

/**
 * Hard cap on how many URLs we'll ever send to Firecrawl from a single scan.
 * At ~$0.002/scrape, 40 URLs = ~$0.08 per refresh. Firecrawl also rate-limits
 * aggressively on the free tier. If Brave finds more, we take the first N in
 * role order so the user's top-priority roles always get scraped first.
 */
const MAX_URLS_PER_SCAN = 40;

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
  // Keep per-site count small — we'd rather have 5 high-quality detail URLs
  // per site than 20 noisy ones that include careers landing pages.
  const perSiteCount = Math.max(5, Math.min(query.limit ?? 7, 10));
  const role = query.role.trim();
  const location = query.location?.trim() ?? "";
  const seen = new Set<string>();
  let rawTotal = 0;

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

    rawTotal += urls.length;
    for (const u of urls) {
      // Only keep URLs that match one of the ATS job-detail patterns.
      if (isJobDetailUrl(u)) seen.add(u);
    }
  }

  console.log(
    `[brave] role="${role}" location="${location}" → ${seen.size}/${rawTotal} job-detail URLs across ${JOB_SITES.length} sites (after shape filter)`,
  );
  return [...seen];
}

/**
 * Apply the global URL cap after all roles have been collected. Exported so
 * the scraper orchestrator can call it once after combining per-role results.
 */
export function capJobUrls(urls: string[]): string[] {
  if (urls.length <= MAX_URLS_PER_SCAN) return urls;
  console.log(
    `[brave] capping ${urls.length} URLs → ${MAX_URLS_PER_SCAN} (MAX_URLS_PER_SCAN)`,
  );
  return urls.slice(0, MAX_URLS_PER_SCAN);
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
