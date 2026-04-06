# AutoApply

A single dashboard that aggregates job listings from LinkedIn, Google Jobs, and Indeed and ranks them against your resume using semantic matching + Claude reranking.

> **Phase 1 (this scaffold):** Auth → Resume upload → Claude parse → Brave Search discovery → Firecrawl extraction → pgvector match → Claude rerank → Dashboard with feed + Kanban pipeline.
>
> **Phase 2 (TODO):** Direct Playwright scraping of LinkedIn / Indeed / Greenhouse / Lever as a supplement to the Brave + Firecrawl pipeline. The worker stub is in `workers/scrape-worker.ts`.

## Stack

- **Frontend:** Next.js 14 (App Router) + React 18 + Tailwind + glassmorphism
- **Auth + DB:** Supabase (Google + LinkedIn OAuth, Postgres, pgvector, RLS)
- **AI matching:** Claude (`claude-sonnet-4-6`) for resume parsing + match reranking
- **Embeddings:** OpenAI `text-embedding-3-small` (1536 dim)
- **Scraping:** Brave Search API (URL discovery) + Firecrawl `/v1/scrape` with JSON Schema (structured extraction). Works across LinkedIn, Indeed, Greenhouse, Lever, Wellfound, Ashby, and more without per-site parsers. Playwright worker stub for Phase 2.
- **Hosting:** Anywhere Next.js runs. Worker is designed for Railway.

## Quick start

### 1. Install

```bash
npm install
# or pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `OPENAI_API_KEY` — from platform.openai.com (used only for embeddings)
- `BRAVE_API_KEY` — from brave.com/search/api (free tier: 2,000 queries/mo). Used to discover job posting URLs across LinkedIn, Indeed, Greenhouse, Lever, etc.
- `FIRECRAWL_API_KEY` — from firecrawl.dev (hobby tier: $16/mo for 3,000 credits). Used to extract structured fields from each job posting URL via JSON Schema.

### 3. Set up Supabase

1. Create a new project at supabase.com
2. Open the SQL editor and paste the contents of `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_widen_job_sources.sql`. The first creates the schema, enables `pgvector`, sets up RLS, and adds the `match_jobs_for_user` RPC. The second widens the `jobs.source` check constraint to support the Brave + Firecrawl multi-board pipeline.
3. Under **Authentication → Providers**, enable **Google** and **LinkedIn (OIDC)**. Add `http://localhost:3000/auth/callback` (and your prod URL) as a redirect URI.

### 4. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000> and sign in.

## User flow

1. **Sign in** with Google or LinkedIn.
2. **Onboarding step 1:** Upload your resume PDF. Claude extracts skills, titles, experience, and suggested target roles.
3. **Onboarding step 2:** Review/edit target roles, dream companies, company size.
4. **Onboarding step 3:** Set work style (remote/hybrid/onsite), locations, salary band, visa needs.
5. **Onboarding step 4:** Confirm and save.
6. **Dashboard:** Click **Refresh** to trigger the full pipeline:
   - **Discover** — Brave Search hits each `target_role × location` query with a `site:` filter across LinkedIn, Indeed, Greenhouse, Lever, Wellfound, and Ashby. Returns ~20 URLs per query, deduped.
   - **Extract** — Firecrawl scrapes each URL in parallel batches of 5 and uses a JSON Schema to extract `title`, `company`, `location`, `salary`, `remote_type`, `description`, and `posted_date`.
   - Generate OpenAI embeddings for each job description
   - Upsert into `jobs` (deduped by title|company|location)
   - Run `match_jobs_for_user` RPC for top-30 by cosine similarity
   - Send those 30 to Claude in parallel batches of 5 for sub-score reranking
   - Composite = `0.3 × vector + 0.7 × claude_overall`
   - Upsert into `job_matches`
7. **Dashboard views:**
   - **Feed** — score-sorted cards with min-score slider, source filter, save/skip actions, click-through Apply, and a drawer showing Claude's reasoning.
   - **Pipeline** — Kanban with `discovered → saved → applied → interviewing → offer → rejected`. Click any chip to advance status.

## Architecture

```
app/
  page.tsx                  marketing landing
  login/page.tsx            OAuth sign-in
  auth/callback/route.ts    OAuth callback → routes to onboarding or dashboard
  onboarding/page.tsx       4-step glassmorphism wizard
  dashboard/                feed + kanban + match drawer
  api/
    resume/parse            POST: PDF → Claude → embed → profiles row
    preferences             POST/GET: preferences row
    jobs/refresh            POST: scrape + embed + upsert + match
    matches                 GET: list matches with filters
    matches/[id]/status     PATCH: update kanban status
lib/
  supabase/                 SSR client, server client, service-role client
  anthropic.ts              Claude client + claudeJSON helper
  openai.ts                 embeddings
  resume-parser.ts          structured profile schema + prompt
  matcher.ts                3-stage matching pipeline
  scraper/
    brave.ts                Brave Search discovery adapter (URLs)
    firecrawl.ts            Firecrawl extraction adapter (JSON Schema)
    index.ts                3-stage orchestrator (discover → extract → dedupe)
    types.ts                NormalizedJob + JobSource shape
workers/
  scrape-worker.ts          Playwright worker stub for Railway
supabase/
  migrations/0001_init.sql              schema + pgvector + RLS + match RPC
  migrations/0002_widen_job_sources.sql widen jobs.source check for multi-board pipeline
middleware.ts               session refresh + auth gate
```

### Why Brave + Firecrawl?

LinkedIn, Indeed, and most ATS-hosted boards actively block traditional scraping. Rather than maintaining brittle per-site Playwright pipelines, we split the problem in two:

1. **Discovery** — Brave Search has a clean, cheap web search API (free up to 2k queries/mo) and supports `site:` filters, so we can find fresh job posting URLs across LinkedIn, Indeed, Greenhouse, Lever, Wellfound, and Ashby with a single query per role.
2. **Extraction** — Firecrawl is a managed scraper that returns clean Markdown plus, crucially, supports JSON Schema extraction backed by an LLM. One schema, dozens of job boards, no per-site parsing.

This gets us multi-board coverage without taking on the maintenance cost of stealth scraping. The Playwright worker stub is still in place so you can supplement with direct scrapes in Phase 2 when you're ready.

### Why Claude for reranking?

Vector cosine similarity gets you to "kinda relevant" cheaply, but it doesn't understand seniority mismatches, location constraints, or industry context. Claude reranking the top 30 candidates against the structured profile gives you a real "this is why" — and the sub-scores power the explainer drawer.

## Cost estimate (per active user)

Assumes 1 refresh per day, ~30 jobs scraped per refresh, top-30 reranked.

| Service       | Usage / day                                | Cost / day | Cost / mo |
| ------------- | ------------------------------------------ | ---------- | --------- |
| Brave Search  | ~3 queries (free tier 2k/mo)               | $0         | $0        |
| Firecrawl     | ~30 URL scrapes × 1 credit = 30 credits    | ~$0.16     | ~$4.80    |
| OpenAI embeds | ~31 docs × 500 tokens × $0.02/1M tokens    | ~$0.0003   | ~$0.01    |
| Claude rerank | 30 calls × ~1k in + 200 out, sonnet-4-6    | ~$0.10     | ~$3.00    |
| Supabase      | Pro tier (covers many users)               | ~$0.33     | $10.00    |
| Hosting       | Vercel hobby + Railway free tier           | $0         | $0        |
| **Total**     |                                            | **~$0.59** | **~$17.81**|

> Brave's free tier covers 2,000 queries/mo (~22/day worth of headroom for 1 user). Firecrawl's hobby plan is $16/mo for 3,000 credits, which covers ~100 refreshes/day at 30 URLs each. Supabase Pro is $10/mo flat regardless of users.

At 100 users / day refresh cadence the Firecrawl line dominates — you'd need the $83/mo Standard plan (~10k credits) plus a Brave paid tier. Squeeze costs by:
- Caching jobs across users (the `jobs` table is global by design — same URL never re-scraped)
- Reranking only top 15 instead of top 30
- Switching to `claude-haiku-4-5` for the rerank stage (~5x cheaper)
- Lowering Brave's `count` from 20 to 10 per query

## Deploying

### Vercel + Supabase (recommended for MVP)

1. Push to GitHub.
2. Import the repo into Vercel.
3. Add all `.env.example` variables to Vercel → Project Settings → Environment Variables.
4. Update Supabase auth redirect URL to your Vercel domain.

### Railway worker (Phase 2)

When you flesh out the Playwright stealth scraper:

```bash
railway up
# Set start command: npm run worker:scrape
# Schedule via Railway cron: every 6 hours
```

## Roadmap

- [ ] **Phase 2:** Real Playwright stealth scraper for LinkedIn/Indeed/Greenhouse with UA rotation, randomized delays, as a supplement to Brave + Firecrawl
- [ ] **Phase 2:** Match-explainer hover tooltips on the kanban view
- [ ] **Phase 2:** Drag-and-drop kanban (currently chip-click)
- [ ] **Phase 3:** Email digest for 80+ matches (Resend)
- [ ] **Phase 3:** "Not interested" feedback loop into next refresh's vector filter
- [ ] **Phase 3:** Admin first-run setup screen for self-hosters
- [ ] **Phase 3:** LinkedIn profile import (OAuth scope) as alternative to PDF upload

## License

MIT — do whatever you want with it.
