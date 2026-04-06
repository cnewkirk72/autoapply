import { dedupeKey } from "../utils";
import { detectSourceFromUrl } from "./brave";
import type { NormalizedJob } from "./types";

/**
 * Firecrawl /v1/scrape adapter — extraction layer.
 *
 * Takes a job posting URL, hits Firecrawl with a JSON Schema describing the
 * fields we want, and returns a NormalizedJob. Firecrawl uses an LLM under the
 * hood to extract structured data from arbitrary job board markup, so this
 * works across LinkedIn, Indeed, Greenhouse, Lever, etc. without per-site
 * parsers.
 *
 * Docs: https://docs.firecrawl.dev/features/extract
 */

const JOB_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "The job title exactly as posted",
    },
    company: {
      type: "string",
      description: "The hiring company name",
    },
    location: {
      type: "string",
      description: "City, state, country, or 'Remote'",
    },
    salary_range: {
      type: "string",
      description:
        "Salary range as posted (e.g., '$120k - $160k'). Empty string if not listed.",
    },
    remote_type: {
      type: "string",
      enum: ["remote", "hybrid", "onsite", "unknown"],
      description: "Work arrangement",
    },
    description: {
      type: "string",
      description:
        "The full job description text, cleaned of navigation and footer content",
    },
    posted_date: {
      type: "string",
      description: "ISO date (YYYY-MM-DD) when the job was posted, if visible",
    },
  },
  required: ["title", "company", "description"],
};

const EXTRACT_PROMPT = `Extract the job posting details from this page. Focus on the actual job content, not navigation, headers, footers, or related job suggestions. If a field is not present on the page, omit it or return an empty string.`;

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    extract?: any;
    json?: any;
    metadata?: { sourceURL?: string; title?: string };
  };
  error?: string;
}

interface ExtractedJob {
  title?: string;
  company?: string;
  location?: string;
  salary_range?: string;
  remote_type?: "remote" | "hybrid" | "onsite" | "unknown";
  description?: string;
  posted_date?: string;
}

async function firecrawlScrape(url: string): Promise<ExtractedJob | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) {
    console.warn("[firecrawl] FIRECRAWL_API_KEY not set");
    return null;
  }

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["json"],
        jsonOptions: {
          schema: JOB_EXTRACT_SCHEMA,
          prompt: EXTRACT_PROMPT,
        },
        onlyMainContent: true,
        waitFor: 1500,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[firecrawl] ${url} → ${res.status}`, text.slice(0, 200));
      return null;
    }

    const body = (await res.json()) as FirecrawlScrapeResponse;
    if (!body.success) {
      console.error(`[firecrawl] ${url} unsuccessful`, body.error);
      return null;
    }

    // Firecrawl has shipped this field under a few names across versions
    return (body.data?.json || body.data?.extract || null) as ExtractedJob | null;
  } catch (err) {
    console.error(`[firecrawl] ${url} threw`, err);
    return null;
  }
}

/**
 * Extract structured jobs from a list of URLs in parallel batches.
 * Concurrency capped to avoid rate limits.
 */
export async function firecrawlExtractJobs(
  urls: string[],
  concurrency = 5,
): Promise<NormalizedJob[]> {
  const out: NormalizedJob[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const data = await firecrawlScrape(url);
        if (!data?.title || !data?.company || !data?.description) return null;

        const source = detectSourceFromUrl(url);
        const job: NormalizedJob = {
          title: data.title,
          company: data.company,
          location: data.location || undefined,
          salary_range: data.salary_range || undefined,
          remote_type: data.remote_type || "unknown",
          source,
          source_url: url,
          posted_date: data.posted_date || undefined,
          description_text: data.description,
          dedupe_key: dedupeKey(data.title, data.company, data.location),
        };
        return job;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) out.push(r.value);
    }
  }

  return out;
}
