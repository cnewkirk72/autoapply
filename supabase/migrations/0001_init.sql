-- AutoApply initial schema
-- Run via `supabase db push` or paste into Supabase SQL editor.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------- USERS ----------
-- Supabase already manages auth.users; this mirrors public metadata.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users self select" on public.users
  for select using (auth.uid() = id);
create policy "users self update" on public.users
  for update using (auth.uid() = id);
create policy "users self insert" on public.users
  for insert with check (auth.uid() = id);

-- Auto-create public.users row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  source text not null check (source in ('upload', 'linkedin')),
  raw_resume_text text,
  structured_profile jsonb not null default '{}'::jsonb,
  profile_embedding vector(1536),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles self all" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists profiles_embedding_idx
  on public.profiles using ivfflat (profile_embedding vector_cosine_ops)
  with (lists = 100);

-- ---------- PREFERENCES ----------
create table if not exists public.preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  target_roles text[] not null default '{}',
  target_companies text[] not null default '{}',
  company_size text[] not null default '{}',
  industries text[] not null default '{}',
  locations text[] not null default '{}',
  remote_preference text check (remote_preference in ('remote','hybrid','onsite','any')),
  salary_min int,
  salary_max int,
  visa_sponsorship boolean default false,
  updated_at timestamptz not null default now()
);

alter table public.preferences enable row level security;

create policy "prefs self all" on public.preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- JOBS ----------
-- Jobs are global (deduped across users) but readable by any authenticated user.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company text not null,
  location text,
  salary_range text,
  remote_type text check (remote_type in ('remote','hybrid','onsite','unknown')),
  source text not null check (source in ('google_jobs','linkedin','indeed','serpapi')),
  source_url text not null,
  posted_date date,
  description_text text,
  description_embedding vector(1536),
  dedupe_key text unique,  -- title|company|location lowercased
  created_at timestamptz not null default now()
);

alter table public.jobs enable row level security;

create policy "jobs read auth" on public.jobs
  for select using (auth.role() = 'authenticated');
-- Inserts/updates only via service role (server). No client policy needed.

create index if not exists jobs_embedding_idx
  on public.jobs using ivfflat (description_embedding vector_cosine_ops)
  with (lists = 100);
create index if not exists jobs_created_at_idx on public.jobs (created_at desc);

-- ---------- JOB MATCHES ----------
create table if not exists public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  vector_score numeric(5,2),
  claude_scores jsonb,        -- {overall, skills, seniority, industry, location, reasoning}
  composite_score numeric(5,2),
  status text not null default 'discovered'
    check (status in ('discovered','saved','applied','interviewing','offer','rejected','not_interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

alter table public.job_matches enable row level security;

create policy "matches self all" on public.job_matches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists job_matches_user_score_idx
  on public.job_matches (user_id, composite_score desc);

-- ---------- CONFIG (admin setup) ----------
create table if not exists public.config (
  key text primary key,
  value text,
  validated boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.config enable row level security;
-- Only service role reads/writes config; no public policies.

-- ---------- VECTOR SEARCH RPC ----------
-- Stage 1 of matching: cosine similarity between profile and jobs.
create or replace function public.match_jobs_for_user(
  p_user_id uuid,
  p_match_count int default 30,
  p_min_similarity float default 0.5
)
returns table (
  job_id uuid,
  similarity float
)
language plpgsql stable as $$
begin
  return query
  select
    j.id as job_id,
    1 - (j.description_embedding <=> p.profile_embedding) as similarity
  from public.jobs j
  cross join public.profiles p
  where p.user_id = p_user_id
    and j.description_embedding is not null
    and p.profile_embedding is not null
    and 1 - (j.description_embedding <=> p.profile_embedding) >= p_min_similarity
  order by j.description_embedding <=> p.profile_embedding
  limit p_match_count;
end;
$$;
