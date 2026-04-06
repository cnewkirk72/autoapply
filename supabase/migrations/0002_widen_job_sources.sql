-- Widen the jobs.source check constraint to support the new
-- Brave + Firecrawl scraping pipeline, which discovers postings across
-- many job boards rather than relying on SerpAPI's Google Jobs widget.

alter table public.jobs drop constraint if exists jobs_source_check;

alter table public.jobs add constraint jobs_source_check
  check (source in (
    'linkedin',
    'indeed',
    'greenhouse',
    'lever',
    'wellfound',
    'ashby',
    'google_jobs',
    'company',
    'other'
  ));
