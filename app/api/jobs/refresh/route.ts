import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scrapeJobsForUser } from "@/lib/scraper";
import { embedBatch } from "@/lib/openai";
import { runMatchingForUser } from "@/lib/matcher";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for end-to-end refresh

/**
 * Triggers a full refresh cycle for the current user:
 *   1. Scrape jobs (SerpAPI) for each target role × location
 *   2. Embed descriptions and upsert into `jobs`
 *   3. Run matching pipeline (vector + Claude rerank)
 */
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = createServiceClient();

  // 1. Load preferences
  const { data: prefs } = await sb
    .from("preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!prefs?.target_roles?.length) {
    return NextResponse.json({ error: "no target roles set" }, { status: 400 });
  }

  // 2. Build query matrix
  const locations = prefs.locations?.length ? prefs.locations : [undefined];
  const queries = prefs.target_roles.flatMap((role: string) =>
    locations.map((loc: string | undefined) => ({ role, location: loc, limit: 15 })),
  );

  // 3. Scrape
  const jobs = await scrapeJobsForUser(queries);
  if (jobs.length === 0) {
    return NextResponse.json({
      scraped: 0,
      matched: 0,
      warning: "No jobs returned. Check SERPAPI_KEY or refine target roles.",
    });
  }

  // 4. Embed descriptions in batches
  const BATCH = 50;
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const embs = await embedBatch(batch.map((j) => j.description_text || j.title));
    allEmbeddings.push(...embs);
  }

  // 5. Upsert jobs
  const rows = jobs.map((j, i) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    salary_range: j.salary_range,
    remote_type: j.remote_type,
    source: j.source,
    source_url: j.source_url,
    posted_date: j.posted_date,
    description_text: j.description_text,
    description_embedding: JSON.stringify(allEmbeddings[i]) as any,
    dedupe_key: j.dedupe_key,
  }));

  const { error: upsertErr } = await sb
    .from("jobs")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: false });
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // 6. Run matching
  const { count } = await runMatchingForUser(user.id);

  return NextResponse.json({ scraped: jobs.length, matched: count });
}
