import { claudeJSON } from "./anthropic";

export interface StructuredProfile {
  name?: string;
  headline?: string;
  summary: string;
  skills: string[];
  job_titles_held: string[];
  years_experience: number;
  education: Array<{ school: string; degree?: string; field?: string; year?: string }>;
  certifications: string[];
  industries: string[];
  suggested_target_roles: string[];
}

const SYSTEM_PROMPT = `You are an expert resume parser. You read raw resume text and extract structured data accurately and conservatively. If a field is not present, omit it or use a sensible empty default. Never invent qualifications.`;

export async function parseResume(rawText: string): Promise<StructuredProfile> {
  const prompt = `Parse the following resume into JSON. Return ONLY a JSON object with this exact shape:

{
  "name": string,
  "headline": string,            // current title or one-line professional headline
  "summary": string,             // 2-3 sentence natural-language career summary
  "skills": string[],            // technical and professional skills, deduped
  "job_titles_held": string[],   // distinct titles, most recent first
  "years_experience": number,    // total full-time years, integer
  "education": [{ "school": string, "degree": string, "field": string, "year": string }],
  "certifications": string[],
  "industries": string[],        // industries the candidate has worked in
  "suggested_target_roles": string[]  // 5-8 roles the candidate is well-suited for
}

RESUME:
"""
${rawText.slice(0, 12000)}
"""\n\nReturn ONLY valid JSON.`;

  return claudeJSON<StructuredProfile>({
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 2048,
  });
}

/** Build a single text blob suitable for embedding the candidate. */
export function profileToEmbeddingText(p: StructuredProfile): string {
  return [
    p.headline,
    p.summary,
    `Skills: ${p.skills?.join(", ")}`,
    `Past roles: ${p.job_titles_held?.join(", ")}`,
    `Industries: ${p.industries?.join(", ")}`,
    `Years of experience: ${p.years_experience}`,
  ]
    .filter(Boolean)
    .join("\n");
}
