import { dedupeKey } from "../utils";
import type { NormalizedJob, ScrapeQuery, ScrapeResult } from "./types";

/**
 * SerpAPI Google Jobs scraper.
 * Docs: https://serpapi.com/google-jobs-api
 *
 * One credit per query. Returns ~10 jobs per page; we paginate via `next_page_token`.
 */
export async function scrapeSerpApiGoogleJobs(
  query: ScrapeQuery,
): Promise<ScrapeResult> {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return { jobs: [], source: "serpapi", blocked: true };
  }

  const limit = query.limit ?? 30;
  const collected: NormalizedJob[] = [];
  let nextPageToken: string | undefined = undefined;
  let pages = 0;

  try {
    while (collected.length < limit && pages < 4) {
      const params = new URLSearchParams({
        engine: "google_jobs",
        q: `${query.role}${query.location ? " " + query.location : ""}`,
        hl: "en",
        api_key: key,
      });
      if (nextPageToken) params.set("next_page_token", nextPageToken);

      const url = `https://serpapi.com/search.json?${params.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error("SerpAPI error", res.status, await res.text());
        break;
      }
      const data = await res.json();

      const jobs = (data.jobs_results || []) as any[];
      for (const j of jobs) {
        const remoteFlag =
          j.detected_extensions?.work_from_home === true ||
          /remote/i.test(j.location || "");
        const job: NormalizedJob = {
          title: j.title,
          company: j.company_name,
          location: j.location,
          salary_range: j.detected_extensions?.salary,
          remote_type: remoteFlag ? "remote" : "unknown",
          source: "google_jobs",
          source_url:
            j.related_links?.[0]?.link ||
            j.share_link ||
            j.apply_options?.[0]?.link ||
            "",
          posted_date: j.detected_extensions?.posted_at
            ? parsePostedAt(j.detected_extensions.posted_at)
            : undefined,
          description_text: j.description || "",
          dedupe_key: dedupeKey(j.title, j.company_name, j.location),
        };
        if (job.source_url) collected.push(job);
      }

      nextPageToken =
        data.serpapi_pagination?.next_page_token ||
        data.search_metadata?.next_page_token;
      if (!nextPageToken) break;
      pages++;
    }

    return { jobs: collected.slice(0, limit), source: "serpapi", blocked: false };
  } catch (err) {
    console.error("SerpAPI scrape failed", err);
    return { jobs: collected, source: "serpapi", blocked: true };
  }
}

/** Convert "3 days ago" → ISO date approximation. */
function parsePostedAt(s: string): string | undefined {
  const m = s.match(/(\d+)\s+(day|week|month|hour)/i);
  if (!m) return undefined;
  const n = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  const ms =
    unit === "hour"
      ? n * 3600_000
      : unit === "day"
        ? n * 86400_000
        : unit === "week"
          ? n * 7 * 86400_000
          : n * 30 * 86400_000;
  return new Date(Date.now() - ms).toISOString().slice(0, 10);
}
