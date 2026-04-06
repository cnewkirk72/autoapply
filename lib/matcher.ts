import { claudeJSON } from "./anthropic";
import { createServiceClient } from "./supabase/server";

export interface ClaudeMatchScores {
  overall_score: number;
  skills_score: number;
  seniority_score: number;
  industry_score: number;
  location_score: number;
  reasoning: string;
}

const RERANK_SYSTEM = `You are a job matching engine. You score candidate-to-job matches accurately and conservatively. Always return ONLY valid JSON — no preamble, no code fences, no commentary.`;

function buildRerankPrompt(args: {
  profile: any;
  preferences: any;
  job: { title: string; company: string; location?: string; description_text?: string };
}) {
  return `Given the candidate profile and job description below, score this match from 0-100 across these dimensions:

- skills_score: How well do the candidate's skills align with the job requirements?
- seniority_score: Is the candidate's experience level appropriate for this role?
- industry_score: How relevant is the candidate's industry background?
- location_score: Does the job's location/remote policy match the candidate's preferences?

Also provide a 1-2 sentence human-readable reasoning explaining the match quality.

Return ONLY valid JSON in this exact shape:
{
  "overall_score": <number 0-100>,
  "skills_score": <number 0-100>,
  "seniority_score": <number 0-100>,
  "industry_score": <number 0-100>,
  "location_score": <number 0-100>,
  "reasoning": "<string>"
}

CANDIDATE PROFILE:
${JSON.stringify(args.profile, null, 2)}

CANDIDATE PREFERENCES:
${JSON.stringify(args.preferences, null, 2)}

JOB:
Title: ${args.job.title}
Company: ${args.job.company}
Location: ${args.job.location || "n/a"}

Description:
${(args.job.description_text || "").slice(0, 4000)}`;
}

/**
 * Run the full matching pipeline for a user:
 *  Stage 1 — pgvector cosine similarity (top 30)
 *  Stage 2 — Claude rerank with structured scoring
 *  Stage 3 — composite = 0.3 * vector + 0.7 * claude
 *  Writes/updates rows in `job_matches`.
 */
export async function runMatchingForUser(userId: string) {
  const sb = createServiceClient();

  // Load profile + prefs
  const [{ data: profile }, { data: prefs }] = await Promise.all([
    sb.from("profiles").select("structured_profile").eq("user_id", userId).single(),
    sb.from("preferences").select("*").eq("user_id", userId).single(),
  ]);

  if (!profile) throw new Error("No profile found for user");

  // Stage 1 — pgvector
  const { data: matches, error } = await sb.rpc("match_jobs_for_user", {
    p_user_id: userId,
    p_match_count: 30,
    p_min_similarity: 0.4,
  });
  if (error) throw error;
  if (!matches || matches.length === 0) return { count: 0 };

  // Hydrate job rows
  const jobIds = matches.map((m: any) => m.job_id);
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, title, company, location, description_text, source_url")
    .in("id", jobIds);

  const jobMap = new Map((jobs || []).map((j: any) => [j.id, j]));

  // Stage 2 — Claude rerank (parallelized, capped concurrency = 5)
  const results: Array<{
    job_id: string;
    vector_score: number;
    claude_scores: ClaudeMatchScores;
    composite_score: number;
  }> = [];

  const concurrency = 5;
  for (let i = 0; i < matches.length; i += concurrency) {
    const batch = matches.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (m: any) => {
        const job = jobMap.get(m.job_id);
        if (!job) return null;
        const scores = await claudeJSON<ClaudeMatchScores>({
          system: RERANK_SYSTEM,
          prompt: buildRerankPrompt({
            profile: profile.structured_profile,
            preferences: prefs || {},
            job,
          }),
          maxTokens: 600,
        });
        const vector_score = Math.round(m.similarity * 100);
        const composite = Math.round(
          0.3 * vector_score + 0.7 * scores.overall_score,
        );
        return {
          job_id: m.job_id,
          vector_score,
          claude_scores: scores,
          composite_score: composite,
        };
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) results.push(s.value);
    }
  }

  // Stage 3 — upsert into job_matches
  const rows = results.map((r) => ({
    user_id: userId,
    job_id: r.job_id,
    vector_score: r.vector_score,
    claude_scores: r.claude_scores,
    composite_score: r.composite_score,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    await sb.from("job_matches").upsert(rows, { onConflict: "user_id,job_id" });
  }

  return { count: rows.length };
}
