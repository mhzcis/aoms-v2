begin;

-- Definitions only: installation never invokes deletion or changes business rows.
create or replace function public.delete_category_field(p_id uuid, p_confirmation text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  f public.category_fields;
  snapshot jsonb;
  result jsonb;
  prior_restore text;
begin
  if not public.is_admin() then raise exception 'حذف الحقول متاح لمدير النظام النشط فقط'; end if;
  if p_confirmation is distinct from 'حذف الحقل' then raise exception 'عبارة تأكيد حذف الحقل غير صحيحة'; end if;
  -- Serialize definitions and typed values, including concurrent writers.
  lock table public.category_fields,public.category_field_options,public.asset_field_values,public.operation_log_values in share row exclusive mode;
  select * into f from public.category_fields where id=p_id for update;
  if not found then raise exception 'الحقل غير موجود؛ حدّث الصفحة'; end if;
  snapshot:=jsonb_build_object(
    'field',to_jsonb(f),
    'options',coalesce((select jsonb_agg(x order by x.id) from public.category_field_options x where field_id=p_id),'[]'::jsonb),
    'asset_values',coalesce((select jsonb_agg(x order by x.asset_id) from public.asset_field_values x where field_id=p_id),'[]'::jsonb),
    'operation_values',coalesce((select jsonb_agg(x order by x.operation_log_id) from public.operation_log_values x where field_id=p_id),'[]'::jsonb));
  result:=jsonb_build_object('field_id',p_id,'options',jsonb_array_length(snapshot->'options'),
    'asset_values',jsonb_array_length(snapshot->'asset_values'),'operation_values',jsonb_array_length(snapshot->'operation_values'));
  -- Reuse the existing guarded bulk-maintenance bypass only inside this admin RPC.
  prior_restore:=current_setting('aoms.in_restore',true);
  perform set_config('aoms.in_restore','true',true);
  delete from public.asset_field_values where field_id=p_id;
  delete from public.operation_log_values where field_id=p_id;
  delete from public.category_field_options where field_id=p_id;
  delete from public.category_fields where id=p_id;
  perform set_config('aoms.in_restore',coalesce(prior_restore,'false'),true);
  insert into public.audit_logs(user_id,action,entity_type,entity_id,before_json,after_json,reason)
    values(auth.uid(),'delete_category_field','category_fields',p_id,snapshot,result,'حذف الحقل وقيمه وخياراته بتأكيد مدير النظام');
  return result;
end $$;
revoke all on function public.delete_category_field(uuid,text) from public,anon;
grant execute on function public.delete_category_field(uuid,text) to authenticated;

commit;
