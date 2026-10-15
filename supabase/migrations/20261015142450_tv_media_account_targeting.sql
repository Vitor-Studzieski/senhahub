alter table public.tv_media
  add column if not exists target_user_id uuid references public.profiles(id);

create index if not exists idx_tv_media_target_playlist
  on public.tv_media (target_user_id, active, upload_status, sort_order, created_at);

comment on column public.tv_media.target_user_id is
  'Optional account target. NULL keeps the media visible on the shared TV playlist.';
