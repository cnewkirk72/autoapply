import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function dedupeKey(title: string, company: string, location?: string) {
  return [title, company, location || ""]
    .map((s) => s.toLowerCase().trim().replace(/\s+/g, " "))
    .join("|");
}

export function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400 border-emerald-400/40 bg-emerald-400/10";
  if (score >= 50) return "text-amber-400 border-amber-400/40 bg-amber-400/10";
  return "text-rose-400 border-rose-400/40 bg-rose-400/10";
}
