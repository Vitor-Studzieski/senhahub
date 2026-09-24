alter table public.print_enrollments
  alter column expires_at set default now() + interval '30 minutes';
