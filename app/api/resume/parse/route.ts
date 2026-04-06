import { NextResponse } from "next/server";
// Import the inner module directly to avoid pdf-parse's known
// "test file at module load" bug in serverless environments.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseResume, profileToEmbeddingText } from "@/lib/resume-parser";
import { embed } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json({ error: "file too large" }, { status: 400 });

  // 1. Extract raw text from PDF
  const buffer = Buffer.from(await file.arrayBuffer());
  let rawText: string;
  try {
    const parsed = await pdfParse(buffer);
    rawText = parsed.text;
  } catch (err) {
    return NextResponse.json({ error: "pdf parse failed" }, { status: 400 });
  }
  if (rawText.trim().length < 100) {
    return NextResponse.json(
      { error: "resume appears empty or unreadable" },
      { status: 400 },
    );
  }

  // 2. Claude structured extraction
  const profile = await parseResume(rawText);

  // 3. Generate profile embedding
  const embedding = await embed(profileToEmbeddingText(profile));

  // 4. Persist (service role bypasses RLS but we set user_id explicitly)
  const sb = createServiceClient();
  const { error } = await sb.from("profiles").upsert(
    {
      user_id: user.id,
      source: "upload",
      raw_resume_text: rawText.slice(0, 50000),
      structured_profile: profile,
      // pgvector accepts the JSON-string form '[1,2,3]' reliably across PostgREST versions
      profile_embedding: JSON.stringify(embedding) as any,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}
