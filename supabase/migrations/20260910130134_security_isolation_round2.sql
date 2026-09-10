-- Defense-in-depth for store/sector permissions.
-- The API still performs the primary authorization; this trigger prevents
-- an accidental cross-store permission row from reaching the database.

create or replace function public.enforce_profile_sector_store()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile_store text;
  v_sector_store text;
begin
  select store_code into v_profile_store
  from public.profiles
  where id = new.profile_id;

  select store_code into v_sector_store
  from public.sectors
  where id = new.sector_id;

  if v_profile_store is not null
    and (v_sector_store is null or v_profile_store <> v_sector_store) then
    raise exception 'profile_sector_store_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists profile_sector_store_boundary on public.profile_sector_permissions;
create constraint trigger profile_sector_store_boundary
after insert or update of profile_id, sector_id on public.profile_sector_permissions
deferrable initially deferred
for each row execute function public.enforce_profile_sector_store();

comment on function public.enforce_profile_sector_store() is
  'Prevents assigning a profile to a sector in another explicitly assigned store.';
