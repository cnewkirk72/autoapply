import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const minScore = parseInt(url.searchParams.get("min") || "0");
  const status = url.searchParams.get("status");

  let query = supabase
    .from("job_matches")
    .select(
      `id, vector_score, claude_scores, composite_score, status, updated_at,
       jobs ( id, title, company, location, salary_range, remote_type, source, source_url, posted_date, description_text )`,
    )
    .eq("user_id", user.id)
    .gte("composite_score", minScore)
    .order("composite_score", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ matches: data });
}
