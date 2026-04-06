import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="glass-strong w-full max-w-2xl rounded-3xl p-12 text-center animate-fade-in">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-widest text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          AI job hunter
        </div>
        <h1 className="bg-gradient-to-br from-white to-slate-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          Stop searching. <br />
          Start matching.
        </h1>
        <p className="mt-6 text-lg text-slate-400">
          AutoApply pulls jobs from LinkedIn, Google Jobs, and Indeed —
          then ranks them against your resume with Claude.
        </p>
        <Link
          href="/login"
          className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 font-medium text-slate-950 transition hover:bg-slate-200"
        >
          Get started →
        </Link>
      </div>
    </main>
  );
}
