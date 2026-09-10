-- Reduce direct service_role blast radius. These tables are reached through
-- controlled RPCs; the runtime does not use direct REST CRUD for them.

begin;

revoke all on table
  public.print_printers,
  public.print_operations,
  public.print_emissions,
  public.print_enrollments,
  public.maintenance_leases
from service_role;

comment on table public.print_printers is
  'Internal print table: accessed through controlled RPCs, not direct service_role REST CRUD.';
comment on table public.print_operations is
  'Internal print audit table: accessed through controlled RPCs, not direct service_role REST CRUD.';
comment on table public.print_emissions is
  'Internal print idempotency table: accessed through controlled RPCs, not direct service_role REST CRUD.';
comment on table public.print_enrollments is
  'Internal print enrollment table: accessed through controlled RPCs, not direct service_role REST CRUD.';
comment on table public.maintenance_leases is
  'Internal maintenance table: accessed through controlled RPCs, not direct service_role REST CRUD.';

commit;
