import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoApply — AI job hunter",
  description:
    "One dashboard for jobs from LinkedIn, Indeed, and Google Jobs — semantically matched against your resume.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 -left-40 h-[40rem] w-[40rem] rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="absolute top-1/3 -right-40 h-[36rem] w-[36rem] rounded-full bg-fuchsia-500/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-[30rem] w-[30rem] rounded-full bg-cyan-500/10 blur-3xl" />
        </div>
        {children}
      </body>
    </html>
  );
}
