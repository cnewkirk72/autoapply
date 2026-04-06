# AutoApply

A single dashboard that aggregates job listings from LinkedIn, Google Jobs, and Indeed and ranks them against your resume using semantic matching + Claude reranking.

> **Phase 1 (this scaffold):** Auth → Resume upload → Claude parse → SerpAPI Google Jobs scrape → pgvector match → Claude rerank → Dashboard with feed + Kanban pipeline.
>
> **Phase 2 (TODO):** Direct Playwright scraping of LinkedIn / Indeed / Google Jobs with stealth, proxy rotation, and SerpAPI fallback. The worker stub is in `workers/scrape-worker.ts`.

## Stack

- **Frontend:** Next.js 14 (App Router) + React 18 + Tailwind + glassmorphism
- **Auth + DB:** Supabase (Google + LinkedIn OAuth, Postgres, pgvector, RLS)
- **AI matching:** Claude (`claude-sonnet-4-6`) for resume parsing + match reranking
- **Embeddings:** OpenAI `text-embedding-3-small` (1536 dim)
- **Scraping:** SerpAPI Google Jobs (Phase 1); Playwright worker stub for Phase 2
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
- `SERPAPI_KEY` — from serpapi.com (Phase 1 job source)

### 3. Set up Supabase

1. Create a new project at supabase.com
2. Open the SQL editor and paste the contents of `supabase/migrations/0001_init.sql`. This creates the schema, enables `pgvector`, sets up RLS, and adds the `match_jobs_for_user` RPC.
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
   - Scrape SerpAPI Google Jobs for each `target_role × location`
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
    serpapi.ts              SerpAPI Google Jobs adapter
    index.ts                orchestrator + dedupe
    types.ts                NormalizedJob shape
workers/
  scrape-worker.ts          Playwright worker stub for Railway
supabase/
  migrations/0001_init.sql  schema + pgvector + RLS + match RPC
middleware.ts               session refresh + auth gate
```

### Why SerpAPI first?

LinkedIn, Indeed, and Google Jobs actively block traditional scraping. Building reliable Playwright stealth pipelines for all three is real work and lives in the gray zone of those sites' ToS. SerpAPI is paid but reliable and stays in compliance via Google's official Jobs widget. The Playwright worker stub is in place so you can flesh it out for Phase 2 when you're ready to take on that risk.

### Why Claude for reranking?

Vector cosine similarity gets you to "kinda relevant" cheaply, but it doesn't understand seniority mismatches, location constraints, or industry context. Claude reranking the top 30 candidates against the structured profile gives you a real "this is why" — and the sub-scores power the explainer drawer.

## Cost estimate (per active user)

Assumes 1 refresh per day, ~30 jobs scraped per refresh, top-30 reranked.

| Service       | Usage / day                                | Cost / day | Cost / mo |
| ------------- | ------------------------------------------ | ---------- | --------- |
| SerpAPI       | ~3 queries × 1 credit = 3 credits          | ~$0.03     | ~$0.90    |
| OpenAI embeds | ~31 docs × 500 tokens × $0.02/1M tokens    | ~$0.0003   | ~$0.01    |
| Claude rerank | 30 calls × ~1k in + 200 out, sonnet-4-6    | ~$0.10     | ~$3.00    |
| Supabase      | Free tier covers MVP                       | $0         | $0        |
| Hosting       | Vercel hobby + Railway free tier           | $0         | $0        |
| **Total**     |                                            | **~$0.13** | **~$3.91**|

At 100 users / day refresh cadence: ~$390/mo. Squeeze costs by:
- Reranking only top 15 instead of top 30
- Switching to `claude-haiku-4-5` for the rerank stage (~5x cheaper)
- Caching jobs across users (the `jobs` table is global by design)

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

- [ ] **Phase 2:** Real Playwright stealth scraper for LinkedIn/Indeed/Google Jobs with UA rotation, randomized delays, and SerpAPI hard-block fallback
- [ ] **Phase 2:** Match-explainer hover tooltips on the kanban view
- [ ] **Phase 2:** Drag-and-drop kanban (currently chip-click)
- [ ] **Phase 3:** Email digest for 80+ matches (Resend)
- [ ] **Phase 3:** "Not interested" feedback loop into next refresh's vector filter
- [ ] **Phase 3:** Admin first-run setup screen for self-hosters
- [ ] **Phase 3:** LinkedIn profile import (OAuth scope) as alternative to PDF upload

## License

MIT — do whatever you want with it.
