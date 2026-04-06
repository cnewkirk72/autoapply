import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID = [
  "discovered",
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "not_interested",
];

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { status } = await req.json();
  if (!VALID.includes(status))
    return NextResponse.json({ error: "invalid status" }, { status: 400 });

  const { error } = await supabase
    .from("job_matches")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
