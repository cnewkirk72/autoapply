"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  ExternalLink,
  Bookmark,
  X,
  Loader2,
  Filter,
  ChevronDown,
  Sparkles,
  LayoutGrid,
  KanbanSquare,
} from "lucide-react";
import { scoreColor } from "@/lib/utils";

interface ClaudeScores {
  overall_score: number;
  skills_score: number;
  seniority_score: number;
  industry_score: number;
  location_score: number;
  reasoning: string;
}

interface Job {
  id: string;
  title: string;
  company: string;
  location?: string;
  salary_range?: string;
  remote_type?: string;
  source: string;
  source_url: string;
  posted_date?: string;
  description_text?: string;
}

interface Match {
  id: string;
  vector_score: number;
  composite_score: number;
  claude_scores: ClaudeScores;
  status: string;
  jobs: Job;
}

const STATUSES = [
  "discovered",
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
] as const;

export default function DashboardClient({ userName }: { userName?: string | null }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [view, setView] = useState<"feed" | "kanban">("feed");
  const [minScore, setMinScore] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [openMatch, setOpenMatch] = useState<Match | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/matches?min=${minScore}`);
    const data = await res.json();
    setMatches(data.matches || []);
    setLoading(false);
  }, [minScore]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "refresh failed");
      setRefreshMsg(`Scraped ${data.scraped} jobs · matched ${data.matched}`);
      await load();
    } catch (err: any) {
      setRefreshMsg("Error: " + err.message);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 5000);
    }
  }

  async function setStatus(matchId: string, status: string) {
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, status } : m)),
    );
    await fetch(`/api/matches/${matchId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  const filtered = matches.filter(
    (m) => sourceFilter === "all" || m.jobs.source === sourceFilter,
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome back{userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {loading ? "Loading…" : `${filtered.length} matches`}
            {refreshMsg && (
              <span className="ml-3 text-emerald-400">· {refreshMsg}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-full border border-white/10 bg-white/5 p-1">
            <button
              onClick={() => setView("feed")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                view === "feed" ? "bg-white text-slate-950" : "text-slate-400"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Feed
            </button>
            <button
              onClick={() => setView("kanban")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                view === "kanban" ? "bg-white text-slate-950" : "text-slate-400"
              }`}
            >
              <KanbanSquare className="h-3.5 w-3.5" />
              Pipeline
            </button>
          </div>

          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Filters */}
      {view === "feed" && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <Filter className="ml-1 h-4 w-4 text-slate-500" />
          <label className="flex items-center gap-2 text-sm">
            Min score
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minScore}
              onChange={(e) => setMinScore(parseInt(e.target.value))}
              className="w-32 accent-emerald-400"
            />
            <span className="w-8 text-emerald-400">{minScore}</span>
          </label>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none"
          >
            <option value="all">All sources</option>
            <option value="google_jobs">Google Jobs</option>
            <option value="linkedin">LinkedIn</option>
            <option value="indeed">Indeed</option>
          </select>
        </div>
      )}

      {/* Body */}
      {loading && matches.length === 0 ? (
        <SkeletonGrid />
      ) : view === "feed" ? (
        <FeedView matches={filtered} onOpen={setOpenMatch} onStatus={setStatus} />
      ) : (
        <KanbanView matches={matches} onStatus={setStatus} onOpen={setOpenMatch} />
      )}

      {openMatch && (
        <MatchDrawer match={openMatch} onClose={() => setOpenMatch(null)} />
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]"
        />
      ))}
    </div>
  );
}

function FeedView({
  matches,
  onOpen,
  onStatus,
}: {
  matches: Match[];
  onOpen: (m: Match) => void;
  onStatus: (id: string, status: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <div className="mt-12 rounded-3xl border border-dashed border-white/10 p-12 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-slate-500" />
        <p className="mt-3 font-medium">No matches yet</p>
        <p className="mt-1 text-sm text-slate-500">
          Click <strong>Refresh</strong> to scrape and match jobs.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((m) => (
        <JobCard key={m.id} match={m} onOpen={onOpen} onStatus={onStatus} />
      ))}
    </div>
  );
}

function JobCard({
  match,
  onOpen,
  onStatus,
}: {
  match: Match;
  onOpen: (m: Match) => void;
  onStatus: (id: string, status: string) => void;
}) {
  const j = match.jobs;
  return (
    <div className="group glass rounded-2xl p-5 transition hover:-translate-y-0.5 hover:bg-white/[0.07]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{j.title}</h3>
          <p className="mt-0.5 truncate text-sm text-slate-400">
            {j.company} · {j.location || "—"}
          </p>
        </div>
        <button
          onClick={() => onOpen(match)}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition hover:scale-105 ${scoreColor(
            match.composite_score,
          )}`}
        >
          {match.composite_score}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        <Badge>{j.source.replace("_", " ")}</Badge>
        {j.remote_type && j.remote_type !== "unknown" && <Badge>{j.remote_type}</Badge>}
        {j.salary_range && <Badge>{j.salary_range}</Badge>}
        {j.posted_date && <Badge muted>{j.posted_date}</Badge>}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => onStatus(match.id, match.status === "saved" ? "discovered" : "saved")}
            title="Save"
            className={`rounded-lg border border-white/10 p-1.5 transition hover:bg-white/10 ${
              match.status === "saved" ? "bg-emerald-400/10 text-emerald-300" : ""
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onStatus(match.id, "not_interested")}
            title="Not interested"
            className="rounded-lg border border-white/10 p-1.5 transition hover:bg-rose-400/10 hover:text-rose-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <a
          href={j.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/20"
        >
          Apply <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

function Badge({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 ${
        muted
          ? "border-white/5 bg-white/[0.02] text-slate-500"
          : "border-white/10 bg-white/5 text-slate-300"
      }`}
    >
      {children}
    </span>
  );
}

function KanbanView({
  matches,
  onStatus,
  onOpen,
}: {
  matches: Match[];
  onStatus: (id: string, status: string) => void;
  onOpen: (m: Match) => void;
}) {
  return (
    <div className="mt-6 grid gap-4 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${STATUSES.length}, minmax(240px, 1fr))` }}>
      {STATUSES.map((status) => {
        const items = matches.filter((m) => m.status === status);
        return (
          <div
            key={status}
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-3"
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {status}
              </h3>
              <span className="text-xs text-slate-500">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onOpen(m)}
                  className="block w-full rounded-xl border border-white/5 bg-white/[0.04] p-3 text-left transition hover:bg-white/10"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.jobs.title}</p>
                      <p className="truncate text-xs text-slate-500">{m.jobs.company}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${scoreColor(m.composite_score)}`}>
                      {m.composite_score}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {STATUSES.filter((s) => s !== status).slice(0, 3).map((s) => (
                      <span
                        key={s}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStatus(m.id, s);
                        }}
                        className="cursor-pointer rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/10"
                      >
                        → {s}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchDrawer({ match, onClose }: { match: Match; onClose: () => void }) {
  const c = match.claude_scores;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-end"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong h-[90vh] w-full overflow-y-auto rounded-t-3xl p-8 sm:h-full sm:max-w-xl sm:rounded-l-3xl sm:rounded-tr-none animate-fade-in"
      >
        <button
          onClick={onClose}
          className="float-right rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-2xl font-bold tracking-tight">{match.jobs.title}</h2>
        <p className="mt-1 text-slate-400">
          {match.jobs.company} · {match.jobs.location}
        </p>

        <div className="mt-6 flex items-center gap-3">
          <div
            className={`flex h-20 w-20 items-center justify-center rounded-full border text-2xl font-bold ${scoreColor(
              match.composite_score,
            )}`}
          >
            {match.composite_score}
          </div>
          <div className="text-sm">
            <p className="font-medium">Composite match score</p>
            <p className="text-slate-500">
              30% vector · 70% Claude rerank
            </p>
          </div>
        </div>

        {c && (
          <div className="mt-6 space-y-3">
            <ScoreBar label="Skills" value={c.skills_score} />
            <ScoreBar label="Seniority" value={c.seniority_score} />
            <ScoreBar label="Industry" value={c.industry_score} />
            <ScoreBar label="Location" value={c.location_score} />

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Claude reasoning
              </p>
              <p className="mt-2 text-sm">{c.reasoning}</p>
            </div>
          </div>
        )}

        {match.jobs.description_text && (
          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Description
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
              {match.jobs.description_text.slice(0, 2000)}
              {match.jobs.description_text.length > 2000 && "…"}
            </p>
          </div>
        )}

        <a
          href={match.jobs.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 font-medium text-slate-950 transition hover:bg-slate-200"
        >
          Apply on {match.jobs.source.replace("_", " ")} <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
