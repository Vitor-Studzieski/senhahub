-- Content library for the public TV display.
-- Files live in Supabase Storage; this table stores only playlist metadata.
alter type public.user_role add value if not exists 'marketing';

create table if not exists public.tv_media (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null unique,
  media_type text not null check (media_type in ('video', 'image')),
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  orientation text not null default 'portrait' check (orientation in ('portrait', 'landscape', 'square')),
  duration_seconds integer not null default 30 check (duration_seconds between 5 and 3600),
  sort_order integer not null default 0 check (sort_order >= 0),
  active boolean not null default false,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'ready')),
  created_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tv_media_playlist
  on public.tv_media (active, upload_status, sort_order, created_at);

alter table public.tv_media enable row level security;
revoke all on table public.tv_media from anon, authenticated;
grant select, insert, update, delete on table public.tv_media to service_role;

comment on table public.tv_media is 'Metadata and playlist ordering for media shown on SenhaHub TV displays.';
