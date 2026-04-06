import type { ScrapeQuery } from "./types";

/**
 * Brave Search API adapter — discovery layer.
 *
 * Returns a list of job posting URLs across LinkedIn, Indeed, Greenhouse,
 * Lever, Wellfound, Ashby, etc. The actual job fields (title, company,
 * description, salary) are extracted in the next stage by Firecrawl.
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search
 */

const JOB_SITE_PATTERNS = [
  "linkedin.com/jobs/view",
  "indeed.com/viewjob",
  "boards.greenhouse.io",
  "jobs.lever.co",
  "wellfound.com/jobs",
  "jobs.ashbyhq.com",
];

/** One Brave query per role × location, OR'd across job-board domains. */
export async function braveSearchJobUrls(
  query: ScrapeQuery,
): Promise<string[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) {
    console.warn("[brave] BRAVE_API_KEY not set; skipping discovery");
    return [];
  }

  const siteFilter = JOB_SITE_PATTERNS.map((s) => `site:${s}`).join(" OR ");
  const q =
    `"${query.role}"` +
    (query.location ? ` "${query.location}"` : "") +
    ` jobs (${siteFilter})`;

  const params = new URLSearchParams({
    q,
    count: String(Math.min(query.limit ?? 20, 20)),
    safesearch: "off",
    freshness: "pm", // past month
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
      console.error("[brave] error", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    const results = (data.web?.results || []) as Array<{ url: string }>;
    return results
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u))
      .filter((u) => JOB_SITE_PATTERNS.some((p) => u.includes(p)));
  } catch (err) {
    console.error("[brave] fetch failed", err);
    return [];
  }
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
