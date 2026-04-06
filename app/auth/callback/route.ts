import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the *public* origin even when the app sits behind a proxy
 * (Railway, Vercel, Fly, etc). `new URL(request.url).origin` reads the
 * internal host header — which on Railway is "http://0.0.0.0:8080" — so
 * we prefer NEXT_PUBLIC_SITE_URL, then x-forwarded-host, then fall back.
 */
function getPublicOrigin(request: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");

  const fwdHost = request.headers.get("x-forwarded-host");
  if (fwdHost) {
    const fwdProto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${fwdProto}://${fwdHost}`;
  }

  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = getPublicOrigin(request);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // First-time users land on onboarding; returning users go straight to dashboard.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();
        return NextResponse.redirect(`${origin}${profile ? next : "/onboarding"}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
