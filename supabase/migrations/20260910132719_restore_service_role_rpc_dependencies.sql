-- The print and lease RPCs are SECURITY INVOKER and need these table
-- privileges while executing under the service_role REST identity.
-- Runtime access remains constrained by explicit table/RPC allowlists.

begin;

grant select, insert, update, delete on table
  public.print_printers,
  public.print_operations,
  public.print_emissions,
  public.print_enrollments,
  public.maintenance_leases
to service_role;

commit;
