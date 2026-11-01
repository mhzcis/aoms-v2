begin;

-- Change function definitions only. This migration does not invoke either RPC
-- and does not delete/update any business data or disable safeupdate.
-- Deriving from the installed definitions preserves deployment-specific restore
-- compatibility code, as well as signatures, owners, ACLs and function settings.
do $migration$
declare
  signature text;
  function_oid oid;
  original_definition text;
  patched_definition text;
  bare_delete_pattern constant text := '(\mdelete[[:space:]]+from[[:space:]]+public\.[a-z_]+[[:space:]]*);';
begin
  foreach signature in array array[
    'public.reset_aoms_data(text,text)',
    'public.restore_aoms_backup(jsonb)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then
      raise exception 'Required function is missing: %', signature;
    end if;
    original_definition := pg_get_functiondef(function_oid);
    patched_definition := regexp_replace(
      original_definition, bare_delete_pattern, E'\\1 WHERE true;', 'gi'
    );
    if patched_definition <> original_definition then
      execute patched_definition;
    end if;
    if pg_get_functiondef(function_oid) ~* bare_delete_pattern then
      raise exception 'Unqualified DELETE remains in %', signature;
    end if;
  end loop;
end;
$migration$;

commit;
