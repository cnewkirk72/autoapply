/**
 * Playwright scrape worker (STUB for Phase 1).
 *
 * Designed to run as a separate Railway service. Reads pending users from
 * Supabase, runs Playwright stealth scrapes against LinkedIn / Indeed /
 * Google Jobs, falls back to SerpAPI on hard blocks, then writes
 * normalized jobs back to the `jobs` table.
 *
 * Phase 1 wires SerpAPI directly from the Next.js API route, so this
 * worker is intentionally minimal — flesh out before promoting to Phase 2.
 *
 * Run locally:  pnpm worker:scrape
 * Run on Railway: configure as a worker service with the same env vars.
 */
import { createClient } from "@supabase/supabase-js";
import { scrapeJobsForUser } from "../lib/scraper";
import { embedBatch } from "../lib/openai";

async function main() {
  if (process.env.PLAYWRIGHT_ENABLED !== "true") {
    console.log("[worker] PLAYWRIGHT_ENABLED=false; exiting (use API route instead).");
    process.exit(0);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // TODO: implement Playwright scrape with stealth + UA rotation per spec.
  // For now, this worker just iterates active users and runs the SerpAPI path.
  const { data: prefs } = await supabase
    .from("preferences")
    .select("user_id, target_roles, locations");

  for (const p of prefs || []) {
    const queries = (p.target_roles || []).flatMap((role: string) =>
      (p.locations?.length ? p.locations : [undefined]).map((loc: any) => ({
        role,
        location: loc,
        limit: 20,
      })),
    );

    const jobs = await scrapeJobsForUser(queries);
    if (jobs.length === 0) continue;

    const embeddings = await embedBatch(jobs.map((j) => j.description_text));
    const rows = jobs.map((j, i) => ({
      ...j,
      description_embedding: embeddings[i],
    }));

    await supabase
      .from("jobs")
      .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: false });
    console.log(`[worker] user=${p.user_id} upserted ${rows.length} jobs`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
