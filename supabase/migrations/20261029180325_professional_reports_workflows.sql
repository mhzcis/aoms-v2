begin;

-- Preserve the effective legacy values before retiring category-level controls.
-- Old columns stay available to old backup files; every current asset owns its rates.
update public.assets a set
  fuel_rate_override=coalesce(case when a.has_fuel_rate_override then a.fuel_rate_override else c.default_fuel_rate end,0),
  chlorine_consumption_override=coalesce(case when a.has_chlorine_consumption_override then a.chlorine_consumption_override else c.default_chlorine_consumption end,0),
  residual_chlorine_override=coalesce(case when a.has_residual_chlorine_override then a.residual_chlorine_override else c.default_residual_chlorine end,0),
  has_fuel_rate_override=true,has_chlorine_consumption_override=true,has_residual_chlorine_override=true
from public.categories c where a.category_id=c.id
and (not a.has_fuel_rate_override or not a.has_chlorine_consumption_override or not a.has_residual_chlorine_override);

create or replace function public.aoms_capture_asset_defaults()
returns trigger language plpgsql set search_path=public as $$
declare c public.categories;
begin
  if current_setting('aoms.in_restore',true)='true' then return new; end if;
  select * into c from public.categories where id=new.category_id;
  new.fuel_rate_override:=coalesce(case when new.has_fuel_rate_override then new.fuel_rate_override when tg_op='UPDATE' and old.has_fuel_rate_override then old.fuel_rate_override else c.default_fuel_rate end,0);
  new.chlorine_consumption_override:=coalesce(case when new.has_chlorine_consumption_override then new.chlorine_consumption_override when tg_op='UPDATE' and old.has_chlorine_consumption_override then old.chlorine_consumption_override else c.default_chlorine_consumption end,0);
  new.residual_chlorine_override:=coalesce(case when new.has_residual_chlorine_override then new.residual_chlorine_override when tg_op='UPDATE' and old.has_residual_chlorine_override then old.residual_chlorine_override else c.default_residual_chlorine end,0);
  new.has_fuel_rate_override:=true;new.has_chlorine_consumption_override:=true;new.has_residual_chlorine_override:=true;
  return new;
end $$;
create trigger zz_aoms_capture_asset_defaults before insert or update on public.assets
for each row execute function public.aoms_capture_asset_defaults();

create or replace function public.aoms_lock_used_fuel_unit()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.unit is distinct from old.unit and (exists(select 1 from public.assets where fuel_type_id=old.id) or exists(select 1 from public.fuel_transactions where fuel_type_id=old.id)) then
    raise exception 'وحدة نوع الوقود مقفلة بعد ربطه بأصل أو تسجيل حركات؛ أنشئ نوع وقود آخر للوحدة الجديدة';
  end if;
  return new;
end $$;
create trigger aoms_lock_used_fuel_unit before update of unit on public.fuel_types
for each row execute function public.aoms_lock_used_fuel_unit();

-- Admin-only, read-only preview. A fingerprint rejects a stale destructive request.
create or replace function public.aoms_reset_preview()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k text; n bigint; h text; counts jsonb:='{}'; fingerprints text:='';
begin
  if not public.is_admin() then raise exception 'المسح الشامل متاح لمدير النظام النشط فقط'; end if;
  foreach k in array array['operation_log_values','operation_logs','fuel_transactions','chlorine_transactions','asset_field_values','timeline_events','assets','category_field_options','category_fields','categories','operators','fuel_types'] loop
    execute format('select count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from public.%I t',k) into n,h;
    counts:=counts||jsonb_build_object(k,n);fingerprints:=fingerprints||k||':'||h||';';
  end loop;
  return jsonb_build_object('counts',counts,'fingerprint',md5(fingerprints));
end $$;

create or replace function public.reset_aoms_data(p_confirmation text,p_expected_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare preview jsonb;
begin
  if not public.is_admin() then raise exception 'المسح الشامل متاح لمدير النظام النشط فقط'; end if;
  if p_confirmation is distinct from 'مسح شامل' then raise exception 'عبارة تأكيد المسح غير صحيحة'; end if;
  lock table public.operation_log_values,public.operation_logs,public.fuel_transactions,public.chlorine_transactions,public.asset_field_values,public.timeline_events,public.assets,public.category_field_options,public.category_fields,public.categories,public.operators,public.fuel_types in access exclusive mode;
  preview:=public.aoms_reset_preview();
  if p_expected_fingerprint is distinct from preview->>'fingerprint' then raise exception 'تغيرت البيانات بعد المعاينة؛ أعد المعاينة وتنزيل نسخة أمان جديدة'; end if;
  perform set_config('aoms.in_restore','true',true);
  delete from public.operation_log_values;delete from public.operation_logs;
  delete from public.fuel_transactions;delete from public.chlorine_transactions;
  delete from public.asset_field_values;delete from public.timeline_events;delete from public.assets;
  delete from public.category_field_options;delete from public.category_fields;delete from public.categories;
  delete from public.operators;delete from public.fuel_types;
  perform set_config('aoms.in_restore','false',true);
  insert into public.audit_logs(user_id,action,entity_type,after_json) values(auth.uid(),'reset_application','system',preview->'counts');
  insert into public.timeline_events(event_type,entity_type,title,metadata,created_by) values('application_reset','system','مسح شامل لبيانات التطبيق',preview->'counts',auth.uid());
  return preview->'counts';
end $$;
revoke all on function public.aoms_reset_preview(),public.reset_aoms_data(text,text) from public,anon;
grant execute on function public.aoms_reset_preview(),public.reset_aoms_data(text,text) to authenticated;

commit;
