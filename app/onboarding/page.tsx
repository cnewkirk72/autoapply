"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Check, ChevronRight, Loader2, X } from "lucide-react";

interface ParsedProfile {
  name?: string;
  headline?: string;
  summary: string;
  skills: string[];
  suggested_target_roles: string[];
  industries: string[];
}

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [parsing, setParsing] = useState(false);
  const [profile, setProfile] = useState<ParsedProfile | null>(null);

  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [targetCompanies, setTargetCompanies] = useState<string[]>([]);
  const [companySize, setCompanySize] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [remotePref, setRemotePref] = useState<"remote" | "hybrid" | "onsite" | "any">("any");
  const [salaryMin, setSalaryMin] = useState<number>(80000);
  const [salaryMax, setSalaryMax] = useState<number>(200000);
  const [visa, setVisa] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleResumeUpload(file: File) {
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/resume/parse", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProfile(data.profile);
      setTargetRoles(data.profile.suggested_target_roles || []);
      setIndustries(data.profile.industries || []);
      setStep(2);
    } catch (err: any) {
      alert("Resume parse failed: " + err.message);
    } finally {
      setParsing(false);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_roles: targetRoles,
          target_companies: targetCompanies,
          company_size: companySize,
          industries,
          locations,
          remote_preference: remotePref,
          salary_min: salaryMin,
          salary_max: salaryMax,
          visa_sponsorship: visa,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/dashboard?firstrun=1");
    } catch (err: any) {
      alert("Save failed: " + err.message);
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl">
        <ProgressBar step={step} total={4} />

        <div className="glass-strong mt-6 rounded-3xl p-8 sm:p-10 animate-fade-in">
          {step === 1 && (
            <Step1Resume
              parsing={parsing}
              onUpload={handleResumeUpload}
            />
          )}
          {step === 2 && (
            <Step2Roles
              suggested={profile?.suggested_target_roles || []}
              roles={targetRoles}
              setRoles={setTargetRoles}
              companies={targetCompanies}
              setCompanies={setTargetCompanies}
              companySize={companySize}
              setCompanySize={setCompanySize}
            />
          )}
          {step === 3 && (
            <Step3Prefs
              remotePref={remotePref}
              setRemotePref={setRemotePref}
              locations={locations}
              setLocations={setLocations}
              salaryMin={salaryMin}
              salaryMax={salaryMax}
              setSalaryMin={setSalaryMin}
              setSalaryMax={setSalaryMax}
              visa={visa}
              setVisa={setVisa}
            />
          )}
          {step === 4 && (
            <Step4Review
              profile={profile}
              targetRoles={targetRoles}
              targetCompanies={targetCompanies}
              locations={locations}
              remotePref={remotePref}
              salaryMin={salaryMin}
              salaryMax={salaryMax}
            />
          )}

          {step > 1 && (
            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={() => setStep(step - 1)}
                className="text-sm text-slate-400 transition hover:text-slate-200"
              >
                ← Back
              </button>
              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 font-medium text-slate-950 transition hover:bg-slate-200"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={finish}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-2.5 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? "Saving…" : "Finish & match jobs"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-all ${
            i < step ? "bg-emerald-400" : "bg-white/10"
          }`}
        />
      ))}
    </div>
  );
}

function Step1Resume({
  parsing,
  onUpload,
}: {
  parsing: boolean;
  onUpload: (f: File) => void;
}) {
  return (
    <div>
      <h2 className="text-3xl font-bold tracking-tight">Upload your resume</h2>
      <p className="mt-2 text-slate-400">
        We'll parse it with Claude to extract your skills, experience, and ideal roles.
      </p>

      <label className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] p-12 transition hover:border-white/30 hover:bg-white/5">
        {parsing ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
            <p className="mt-4 text-sm text-slate-400">Parsing your resume…</p>
          </>
        ) : (
          <>
            <Upload className="h-10 w-10 text-slate-500" />
            <p className="mt-4 font-medium">Drop your PDF here or click to browse</p>
            <p className="mt-1 text-xs text-slate-500">PDF, max 10MB</p>
          </>
        )}
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
          }}
        />
      </label>
    </div>
  );
}

function ChipInput({
  label,
  values,
  setValues,
  placeholder,
}: {
  label: string;
  values: string[];
  setValues: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <label className="text-sm font-medium text-slate-300">{label}</label>
      <div className="mt-2 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/5 p-2">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-sm"
          >
            {v}
            <button
              onClick={() => setValues(values.filter((x) => x !== v))}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
              e.preventDefault();
              if (!values.includes(draft.trim())) setValues([...values, draft.trim()]);
              setDraft("");
            }
          }}
          placeholder={placeholder}
          className="flex-1 min-w-[120px] bg-transparent px-2 py-1 text-sm outline-none"
        />
      </div>
    </div>
  );
}

function Step2Roles(props: {
  suggested: string[];
  roles: string[];
  setRoles: (v: string[]) => void;
  companies: string[];
  setCompanies: (v: string[]) => void;
  companySize: string[];
  setCompanySize: (v: string[]) => void;
}) {
  const sizes = ["Startup (1-50)", "Mid-market (50-500)", "Enterprise (500+)"];
  return (
    <div>
      <h2 className="text-3xl font-bold tracking-tight">Target roles</h2>
      <p className="mt-2 text-slate-400">
        We pre-filled these from your resume. Edit, add, or remove as needed.
      </p>

      <div className="mt-6 space-y-5">
        <ChipInput
          label="Roles you want"
          values={props.roles}
          setValues={props.setRoles}
          placeholder="Type a role and press enter"
        />
        <ChipInput
          label="Dream companies (optional)"
          values={props.companies}
          setValues={props.setCompanies}
          placeholder="Anthropic, Linear, Vercel…"
        />

        <div>
          <label className="text-sm font-medium text-slate-300">Company size</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {sizes.map((s) => (
              <button
                key={s}
                onClick={() =>
                  props.setCompanySize(
                    props.companySize.includes(s)
                      ? props.companySize.filter((x) => x !== s)
                      : [...props.companySize, s],
                  )
                }
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  props.companySize.includes(s)
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Step3Prefs(props: {
  remotePref: "remote" | "hybrid" | "onsite" | "any";
  setRemotePref: (v: any) => void;
  locations: string[];
  setLocations: (v: string[]) => void;
  salaryMin: number;
  salaryMax: number;
  setSalaryMin: (n: number) => void;
  setSalaryMax: (n: number) => void;
  visa: boolean;
  setVisa: (b: boolean) => void;
}) {
  const remoteOpts: Array<"remote" | "hybrid" | "onsite" | "any"> = [
    "remote",
    "hybrid",
    "onsite",
    "any",
  ];
  return (
    <div>
      <h2 className="text-3xl font-bold tracking-tight">Preferences</h2>
      <p className="mt-2 text-slate-400">Help us filter out jobs you don't want.</p>

      <div className="mt-6 space-y-5">
        <div>
          <label className="text-sm font-medium text-slate-300">Work style</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {remoteOpts.map((r) => (
              <button
                key={r}
                onClick={() => props.setRemotePref(r)}
                className={`rounded-full border px-4 py-1.5 text-sm capitalize transition ${
                  props.remotePref === r
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <ChipInput
          label="Locations"
          values={props.locations}
          setValues={props.setLocations}
          placeholder="San Francisco, New York, Remote-US…"
        />

        <div>
          <label className="text-sm font-medium text-slate-300">
            Salary range (USD): ${props.salaryMin.toLocaleString()} – $
            {props.salaryMax.toLocaleString()}
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <input
              type="number"
              step={5000}
              value={props.salaryMin}
              onChange={(e) => props.setSalaryMin(parseInt(e.target.value || "0"))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 outline-none focus:border-white/30"
            />
            <input
              type="number"
              step={5000}
              value={props.salaryMax}
              onChange={(e) => props.setSalaryMax(parseInt(e.target.value || "0"))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 outline-none focus:border-white/30"
            />
          </div>
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={props.visa}
            onChange={(e) => props.setVisa(e.target.checked)}
            className="h-4 w-4 rounded border-white/20"
          />
          <span className="text-sm text-slate-300">I need visa sponsorship</span>
        </label>
      </div>
    </div>
  );
}

function Step4Review(props: {
  profile: ParsedProfile | null;
  targetRoles: string[];
  targetCompanies: string[];
  locations: string[];
  remotePref: string;
  salaryMin: number;
  salaryMax: number;
}) {
  return (
    <div>
      <h2 className="text-3xl font-bold tracking-tight">Review</h2>
      <p className="mt-2 text-slate-400">Looks good? Click finish and we'll start matching.</p>

      <dl className="mt-6 space-y-4 text-sm">
        <Row label="Headline" value={props.profile?.headline || "—"} />
        <Row label="Target roles" value={props.targetRoles.join(", ") || "—"} />
        <Row label="Companies" value={props.targetCompanies.join(", ") || "Any"} />
        <Row label="Locations" value={props.locations.join(", ") || "Any"} />
        <Row label="Work style" value={props.remotePref} />
        <Row
          label="Salary"
          value={`$${props.salaryMin.toLocaleString()} – $${props.salaryMax.toLocaleString()}`}
        />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 pb-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
