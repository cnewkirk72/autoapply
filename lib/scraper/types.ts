export type JobSource =
  | "linkedin"
  | "indeed"
  | "greenhouse"
  | "lever"
  | "wellfound"
  | "ashby"
  | "google_jobs"
  | "company"
  | "other";

export interface NormalizedJob {
  title: string;
  company: string;
  location?: string;
  salary_range?: string;
  remote_type: "remote" | "hybrid" | "onsite" | "unknown";
  source: JobSource;
  source_url: string;
  posted_date?: string; // ISO date
  description_text: string;
  dedupe_key: string;
}

export interface ScrapeQuery {
  role: string;
  location?: string;
  remote?: boolean;
  limit?: number;
}

export interface ScrapeResult {
  jobs: NormalizedJob[];
  source: string;
  blocked: boolean;
}
