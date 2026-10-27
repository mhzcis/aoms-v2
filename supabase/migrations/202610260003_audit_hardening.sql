-- =====================================================================
-- AOMS V2 — Migration 003: audit hardening (zero-trust review fixes)
-- Every change here closes a defect that was reproduced against a real
-- PostgreSQL 17 instance (see supabase/tests/run-db-tests.mjs).
-- Idempotent where practical; safe to run once after migrations 001 and 002.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Business time zone. current_date inside RPCs/CHECKs must be the local
--    business day, not UTC (otherwise 00:00–02/03:00 local yields false
--    "future date" errors). Change this single value if deployed elsewhere.
-- ---------------------------------------------------------------------
create or replace function public.aoms_business_timezone()
returns text language sql immutable as $$ select 'Asia/Jerusalem'::text $$;

-- ---------------------------------------------------------------------
-- 1. Privileges. Supabase grants ALL on public objects to anon/authenticated
--    by default and EXECUTE on functions to PUBLIC. Lock this down.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
revoke truncate, references, trigger, delete on all tables in schema public from authenticated;
-- Transactional tables are written exclusively through SECURITY DEFINER RPCs.
revoke insert, update on
  public.assets, public.asset_field_values, public.operation_logs, public.operation_log_values,
  public.fuel_transactions, public.chlorine_transactions, public.timeline_events, public.audit_logs,
  public.asset_effective_defaults, public.asset_fuel_balances, public.asset_chlorine_balances
from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------
-- 2. Generic stamping: created_by/updated_by/updated_at (AUTH-008) and a real
--    optimistic-lock version bump (SYNC-008) for tables edited directly.
-- ---------------------------------------------------------------------
create or replace function public.aoms_meaningful_change(p_old jsonb, p_new jsonb)
returns boolean language sql immutable as $$
  select (p_old - array['version','updated_at','updated_by','next_asset_sequence','has_historical_values'])
         is distinct from
         (p_new - array['version','updated_at','updated_by','next_asset_sequence','has_historical_values'])
$$;

create or replace function public.trg_stamp_row_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if j ? 'created_by' then new := jsonb_populate_record(new, jsonb_build_object('created_by', coalesce(auth.uid()::text, j ->> 'created_by'))); end if;
    if j ? 'updated_by' then new := jsonb_populate_record(new, jsonb_build_object('updated_by', coalesce(auth.uid()::text, j ->> 'updated_by'))); end if;
    if j ? 'version' then new := jsonb_populate_record(new, jsonb_build_object('version', 1)); end if;
    return new;
  end if;
  -- UPDATE: never let a client rewrite authorship / version history
  if j ? 'created_by' then new := jsonb_populate_record(new, jsonb_build_object('created_by', to_jsonb(old) -> 'created_by')); end if;
  if j ? 'created_at' then new := jsonb_populate_record(new, jsonb_build_object('created_at', to_jsonb(old) -> 'created_at')); end if;
  if public.aoms_meaningful_change(to_jsonb(old), to_jsonb(new)) then
    if j ? 'version' then new := jsonb_populate_record(new, jsonb_build_object('version', (to_jsonb(old) ->> 'version')::bigint + 1)); end if;
    if j ? 'updated_by' then new := jsonb_populate_record(new, jsonb_build_object('updated_by', coalesce(auth.uid()::text, to_jsonb(new) ->> 'updated_by'))); end if;
    if j ? 'updated_at' then new := jsonb_populate_record(new, jsonb_build_object('updated_at', now())); end if;
  elsif j ? 'version' then
    new := jsonb_populate_record(new, jsonb_build_object('version', to_jsonb(old) -> 'version'));
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['categories','category_fields','category_field_options','operators','fuel_types','profiles','app_settings'] loop
    execute format('drop trigger if exists trg_stamp_row on public.%I', t);
    execute format('create trigger trg_stamp_row before insert or update on public.%I for each row execute function public.trg_stamp_row_fn()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Audit trail for directly-managed admin entities (AUDIT-001/002).
-- ---------------------------------------------------------------------
create or replace function public.trg_audit_admin_entity_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entity text := case tg_table_name
    when 'categories' then 'category' when 'category_fields' then 'category_field'
    when 'category_field_options' then 'category_field_option' when 'operators' then 'operator'
    when 'fuel_types' then 'fuel_type' when 'profiles' then 'profile' when 'app_settings' then 'app_setting'
    else tg_table_name end;
  v_id uuid;
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return null;
  end if;
  if tg_op = 'UPDATE' and not public.aoms_meaningful_change(to_jsonb(old), to_jsonb(new)) then
    return null;
  end if;
  if tg_table_name <> 'app_settings' then
    v_id := (to_jsonb(new) ->> 'id')::uuid;
  end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json, after_json, reason)
  values (
    auth.uid(),
    case when tg_op = 'INSERT' then 'create' else 'update' end,
    v_entity, v_id,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new),
    case when tg_table_name = 'app_settings' then 'key=' || (to_jsonb(new) ->> 'key') end
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['categories','category_fields','category_field_options','operators','fuel_types','profiles','app_settings'] loop
    execute format('drop trigger if exists trg_audit_admin_entity on public.%I', t);
    execute format('create trigger trg_audit_admin_entity after insert or update on public.%I for each row execute function public.trg_audit_admin_entity_fn()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Immutable audit log (AUDIT-003/004) and append-only timeline.
-- ---------------------------------------------------------------------
create or replace function public.trg_audit_immutable_fn()
returns trigger language plpgsql as $$
begin
  raise exception 'سجل التدقيق غير قابل للتعديل أو الحذف';
end;
$$;
drop trigger if exists trg_audit_immutable on public.audit_logs;
create trigger trg_audit_immutable before update or delete on public.audit_logs
for each row execute function public.trg_audit_immutable_fn();
drop trigger if exists trg_audit_no_truncate on public.audit_logs;
create trigger trg_audit_no_truncate before truncate on public.audit_logs
for each statement execute function public.trg_audit_immutable_fn();

create or replace function public.trg_timeline_append_only_fn()
returns trigger language plpgsql as $$
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return old;
  end if;
  raise exception 'الخط الزمني للأحداث للإضافة فقط';
end;
$$;
drop trigger if exists trg_timeline_append_only on public.timeline_events;
create trigger trg_timeline_append_only before update or delete on public.timeline_events
for each row execute function public.trg_timeline_append_only_fn();

-- ---------------------------------------------------------------------
-- 5. Profiles: never lose the last active administrator; auto-create a
--    profile (viewer, inactive) for every new Supabase Auth user so the
--    admin can activate/assign a role from the Users screen.
-- ---------------------------------------------------------------------
create or replace function public.trg_protect_profiles_fn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return new;
  end if;
  if new.id <> old.id then
    raise exception 'لا يمكن تغيير معرّف المستخدم';
  end if;
  if old.role = 'admin' and old.status = 'active' and (new.role <> 'admin' or new.status <> 'active')
     and not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.status = 'active') then
    raise exception 'لا يمكن إزالة صلاحية آخر مدير نشط للنظام';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_profiles on public.profiles;
create trigger trg_protect_profiles before update on public.profiles
for each row execute function public.trg_protect_profiles_fn();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    'viewer',
    'inactive'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_aoms on auth.users;
create trigger on_auth_user_created_aoms after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- 6. Ledger invariants enforced in the database itself (FUEL-014, CHL,
--    OPLOG-011/012): per-asset serialization lock, "latest record only"
--    for UPDATE/DELETE, and non-negative balances after every change.
-- ---------------------------------------------------------------------
create or replace function public.trg_ledger_guard_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(old);
  v_newer boolean;
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return coalesce(new, old);
  end if;
  perform 1 from public.assets where id = coalesce((to_jsonb(new) ->> 'asset_id')::uuid, (r ->> 'asset_id')::uuid) for update;
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_table_name = 'operation_logs' then
      select exists (select 1 from public.operation_logs x where x.asset_id = old.asset_id and x.id <> old.id
        and (x.operation_date > (r ->> 'operation_date')::date
             or (x.operation_date = (r ->> 'operation_date')::date and x.created_at > (r ->> 'created_at')::timestamptz))) into v_newer;
    elsif tg_table_name = 'fuel_transactions' then
      select exists (select 1 from public.fuel_transactions x where x.asset_id = old.asset_id and x.id <> old.id
        and (x.transaction_date > (r ->> 'transaction_date')::date
             or (x.transaction_date = (r ->> 'transaction_date')::date and x.created_at > (r ->> 'created_at')::timestamptz))) into v_newer;
    else
      select exists (select 1 from public.chlorine_transactions x where x.asset_id = old.asset_id and x.id <> old.id
        and (x.transaction_date > (r ->> 'transaction_date')::date
             or (x.transaction_date = (r ->> 'transaction_date')::date and x.created_at > (r ->> 'created_at')::timestamptz))) into v_newer;
    end if;
    if v_newer then
      raise exception 'لا يمكن تعديل أو حذف سوى آخر سجل/حركة لهذا الأصل';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.asset_id <> old.asset_id then
    raise exception 'لا يمكن تغيير الأصل المرتبط بالسجل';
  end if;
  return new;
end;
$$;

create or replace function public.trg_assert_balances_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_asset uuid;
  v_min numeric;
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return null;
  end if;
  for v_asset in
    select distinct x from unnest(array[(to_jsonb(new) ->> 'asset_id')::uuid, (to_jsonb(old) ->> 'asset_id')::uuid]) x where x is not null
  loop
    if tg_table_name in ('fuel_transactions', 'operation_logs') then
      select min(balance) into v_min from public.asset_fuel_balances where asset_id = v_asset;
      if v_min < 0 then
        raise exception 'لا يسمح برصيد وقود سالب لهذا الأصل (الرصيد الناتج: %)', v_min;
      end if;
    end if;
    if tg_table_name in ('chlorine_transactions', 'operation_logs') then
      select min(balance) into v_min from public.asset_chlorine_balances where asset_id = v_asset;
      if v_min < 0 then
        raise exception 'لا يسمح برصيد كلور سالب لهذا الأصل (الرصيد الناتج: %)', v_min;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['operation_logs','fuel_transactions','chlorine_transactions'] loop
    execute format('drop trigger if exists trg_ledger_guard on public.%I', t);
    execute format('create trigger trg_ledger_guard before insert or update or delete on public.%I for each row execute function public.trg_ledger_guard_fn()', t);
    execute format('drop trigger if exists trg_assert_balances on public.%I', t);
    execute format('create trigger trg_assert_balances after insert or update or delete on public.%I for each row execute function public.trg_assert_balances_fn()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Dynamic values: permission check (was callable by ANY role, incl. anon),
--    reject NaN/Infinity, clear a value when emptied, keep an already-stored
--    (now inactive) select option on edit.
-- ---------------------------------------------------------------------
create or replace function public.validate_and_save_dynamic_values(
  p_category_id uuid,
  p_scope public.field_scope,
  p_target_id uuid,
  p_values jsonb,
  p_record_created_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.category_fields;
  raw_val jsonb;
  txt_val text;
  num_val numeric;
  date_val date;
  bool_val boolean;
  opt_id uuid;
  v_ok boolean;
begin
  if p_scope = 'asset' then
    v_ok := public.is_admin()
      and exists (select 1 from public.assets where id = p_target_id and category_id = p_category_id);
  else
    v_ok := public.can_operate()
      and exists (select 1 from public.operation_logs l join public.assets a on a.id = l.asset_id
                  where l.id = p_target_id and a.category_id = p_category_id);
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  for f in
    select * from public.category_fields
    where category_id = p_category_id and scope = p_scope and is_active = true
    order by sort_order asc
  loop
    raw_val := coalesce(p_values -> (f.id::text), p_values -> f.field_key);
    txt_val := null; num_val := null; date_val := null; bool_val := null; opt_id := null;

    if raw_val is null or raw_val = 'null'::jsonb or (jsonb_typeof(raw_val) = 'string' and trim(raw_val #>> '{}') = '') then
      if f.is_required then
        raise exception 'الحقل الديناميكي الإلزامي «%» مطلوب', f.label;
      end if;
      -- explicit empty value clears a previously stored value
      if raw_val is not null then
        if p_scope = 'asset' then
          delete from public.asset_field_values where asset_id = p_target_id and field_id = f.id;
        else
          delete from public.operation_log_values where operation_log_id = p_target_id and field_id = f.id;
        end if;
      end if;
      continue;
    end if;

    if f.field_type = 'text' then
      txt_val := raw_val #>> '{}';
      if char_length(txt_val) > 2000 then
        raise exception 'قيمة الحقل «%» أطول من المسموح', f.label;
      end if;
    elsif f.field_type = 'number' then
      begin
        num_val := (raw_val #>> '{}')::numeric;
      exception when others then
        raise exception 'قيمة الحقل «%» يجب أن تكون رقمًا صالحًا', f.label;
      end;
      if num_val = 'NaN'::numeric or lower(raw_val #>> '{}') like '%inf%' then
        raise exception 'قيمة الحقل «%» يجب أن تكون رقمًا صالحًا', f.label;
      end if;
    elsif f.field_type = 'date' then
      if (raw_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'قيمة الحقل «%» يجب أن تكون تاريخًا صالحًا', f.label;
      end if;
      begin
        date_val := (raw_val #>> '{}')::date;
      exception when others then
        raise exception 'قيمة الحقل «%» يجب أن تكون تاريخًا صالحًا', f.label;
      end;
    elsif f.field_type = 'boolean' then
      if jsonb_typeof(raw_val) = 'boolean' or (raw_val #>> '{}') in ('true', 'false') then
        bool_val := (raw_val #>> '{}')::boolean;
      else
        raise exception 'قيمة الحقل «%» يجب أن تكون منطقية (نعم/لا)', f.label;
      end if;
    elsif f.field_type = 'select' then
      select o.id into opt_id
      from public.category_field_options o
      where o.field_id = f.id
        and (o.id::text = (raw_val #>> '{}') or o.value_key = (raw_val #>> '{}'))
        and (
          o.is_active
          or (p_scope = 'asset' and exists (select 1 from public.asset_field_values v where v.asset_id = p_target_id and v.field_id = f.id and v.value_option_id = o.id))
          or (p_scope = 'operation' and exists (select 1 from public.operation_log_values v where v.operation_log_id = p_target_id and v.field_id = f.id and v.value_option_id = o.id))
        )
      limit 1;
      if opt_id is null then
        raise exception 'الخيار المحدد للحقل «%» غير صالح أو غير نشط', f.label;
      end if;
      update public.category_field_options set has_historical_values = true where id = opt_id and not has_historical_values;
    end if;

    update public.category_fields set has_historical_values = true where id = f.id and not has_historical_values;

    if p_scope = 'asset' then
      insert into public.asset_field_values (asset_id, field_id, value_text, value_number, value_date, value_boolean, value_option_id, created_by, updated_by, updated_at)
      values (p_target_id, f.id, txt_val, num_val, date_val, bool_val, opt_id, auth.uid(), auth.uid(), now())
      on conflict (asset_id, field_id) do update set
        value_text = excluded.value_text, value_number = excluded.value_number, value_date = excluded.value_date,
        value_boolean = excluded.value_boolean, value_option_id = excluded.value_option_id,
        updated_by = auth.uid(), updated_at = now();
    else
      insert into public.operation_log_values (operation_log_id, field_id, value_text, value_number, value_date, value_boolean, value_option_id, created_by, updated_by, updated_at)
      values (p_target_id, f.id, txt_val, num_val, date_val, bool_val, opt_id, auth.uid(), auth.uid(), now())
      on conflict (operation_log_id, field_id) do update set
        value_text = excluded.value_text, value_number = excluded.value_number, value_date = excluded.value_date,
        value_boolean = excluded.value_boolean, value_option_id = excluded.value_option_id,
        updated_by = auth.uid(), updated_at = now();
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Default-asset handling: serialize on the category row so concurrent
--    default changes are ordered instead of failing on the unique index;
--    log the implicit "default_unset" when a new default asset is created;
--    reject an attempted category change explicitly.
-- ---------------------------------------------------------------------
create or replace function public.create_asset(p_asset jsonb, p_values jsonb default '{}')
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.categories;
  a public.assets;
  prev_default public.assets;
  seq bigint;
  want_default boolean;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select * into c from public.categories where id = (p_asset ->> 'category_id')::uuid for update;
  if c.id is null then
    raise exception 'التصنيف غير موجود';
  end if;
  if c.status <> 'active' then
    raise exception 'لا يمكن إنشاء أصل تحت تصنيف معطل';
  end if;
  if nullif(trim(coalesce(p_asset ->> 'name', '')), '') is null then
    raise exception 'اسم الأصل مطلوب';
  end if;

  seq := c.next_asset_sequence;
  if seq > 9999 then
    raise exception 'تم استنفاد تسلسل أكواد هذا التصنيف (9999)';
  end if;
  update public.categories set next_asset_sequence = seq + 1 where id = c.id;

  want_default := coalesce((p_asset ->> 'is_default')::boolean, false) and coalesce(p_asset ->> 'status', 'active') = 'active';
  if want_default then
    select * into prev_default from public.assets where category_id = c.id and is_default = true for update;
    if prev_default.id is not null then
      update public.assets
      set is_default = false, updated_at = now(), updated_by = auth.uid(), version = version + 1
      where id = prev_default.id;
      insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
      values (prev_default.id, 'default_unset', 'asset', prev_default.id, 'إلغاء التعيين كأصل افتراضي', auth.uid());
    end if;
  end if;

  insert into public.assets (
    asset_code, name, category_id, location, notes, status, is_default,
    has_fuel_rate_override, fuel_rate_override,
    has_chlorine_consumption_override, chlorine_consumption_override,
    has_residual_chlorine_override, residual_chlorine_override,
    created_by, updated_by
  )
  values (
    c.code_prefix || '-' || lpad(seq::text, 4, '0'),
    trim(p_asset ->> 'name'),
    c.id,
    p_asset ->> 'location',
    p_asset ->> 'notes',
    coalesce((p_asset ->> 'status')::public.entity_status, 'active'),
    want_default,
    coalesce((p_asset ->> 'has_fuel_rate_override')::boolean, false),
    case when coalesce((p_asset ->> 'has_fuel_rate_override')::boolean, false) then nullif(p_asset ->> 'fuel_rate_override', '')::numeric end,
    coalesce((p_asset ->> 'has_chlorine_consumption_override')::boolean, false),
    case when coalesce((p_asset ->> 'has_chlorine_consumption_override')::boolean, false) then nullif(p_asset ->> 'chlorine_consumption_override', '')::numeric end,
    coalesce((p_asset ->> 'has_residual_chlorine_override')::boolean, false),
    case when coalesce((p_asset ->> 'has_residual_chlorine_override')::boolean, false) then nullif(p_asset ->> 'residual_chlorine_override', '')::numeric end,
    auth.uid(),
    auth.uid()
  )
  returning * into a;

  perform public.validate_and_save_dynamic_values(c.id, 'asset', a.id, coalesce(p_values, '{}'::jsonb), a.created_at);

  insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, description, created_by)
  values (a.id, 'asset_created', 'asset', a.id, 'إنشاء الأصل ' || a.asset_code, a.name, auth.uid());
  if want_default then
    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (a.id, 'default_set', 'asset', a.id, 'تعيين كأصل افتراضي للتصنيف', auth.uid());
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'create', 'asset', a.id, to_jsonb(a));

  return a;
end;
$$;

create or replace function public.update_asset(
  p_id uuid,
  p_version bigint,
  p_asset jsonb,
  p_values jsonb default '{}'
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  old_a public.assets;
  new_a public.assets;
  prev_default public.assets;
  new_status public.entity_status;
  new_default boolean;
  replacement_id uuid;
  v_cat uuid;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select category_id into v_cat from public.assets where id = p_id;
  if v_cat is null then
    raise exception 'الأصل غير موجود';
  end if;
  -- category row lock serializes every default-asset change in this category
  perform 1 from public.categories where id = v_cat for update;

  select * into old_a from public.assets where id = p_id for update;
  if p_version is not null and old_a.version <> p_version then
    raise exception 'تعارض إصدار: تم تعديل الأصل من جهاز آخر (الإصدار الحالي: %)', old_a.version;
  end if;
  if nullif(p_asset ->> 'category_id', '') is not null and (p_asset ->> 'category_id')::uuid <> old_a.category_id then
    raise exception 'لا يمكن تغيير تصنيف الأصل بعد إنشائه لأن الكود مرتبط باختصار التصنيف';
  end if;

  new_status := coalesce((p_asset ->> 'status')::public.entity_status, old_a.status);
  new_default := coalesce((p_asset ->> 'is_default')::boolean, old_a.is_default);

  if new_status = 'inactive' then
    new_default := false;
  elsif old_a.status = 'inactive' and new_status = 'active' and (p_asset ->> 'is_default') is null then
    new_default := false;
  end if;

  if new_default and not old_a.is_default then
    select * into prev_default from public.assets
    where category_id = old_a.category_id and is_default = true and id <> old_a.id for update;
    if prev_default.id is not null then
      update public.assets
      set is_default = false, updated_at = now(), updated_by = auth.uid(), version = version + 1
      where id = prev_default.id;
      insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
      values (prev_default.id, 'default_unset', 'asset', prev_default.id, 'إلغاء التعيين كأصل افتراضي', auth.uid());
    end if;
  end if;

  update public.assets
  set
    name = coalesce(nullif(trim(p_asset ->> 'name'), ''), old_a.name),
    location = coalesce(p_asset ->> 'location', old_a.location),
    notes = coalesce(p_asset ->> 'notes', old_a.notes),
    status = new_status,
    is_default = new_default,
    has_fuel_rate_override = coalesce((p_asset ->> 'has_fuel_rate_override')::boolean, old_a.has_fuel_rate_override),
    fuel_rate_override = case
      when coalesce((p_asset ->> 'has_fuel_rate_override')::boolean, old_a.has_fuel_rate_override)
      then coalesce(nullif(p_asset ->> 'fuel_rate_override', '')::numeric, old_a.fuel_rate_override)
      else null
    end,
    has_chlorine_consumption_override = coalesce((p_asset ->> 'has_chlorine_consumption_override')::boolean, old_a.has_chlorine_consumption_override),
    chlorine_consumption_override = case
      when coalesce((p_asset ->> 'has_chlorine_consumption_override')::boolean, old_a.has_chlorine_consumption_override)
      then coalesce(nullif(p_asset ->> 'chlorine_consumption_override', '')::numeric, old_a.chlorine_consumption_override)
      else null
    end,
    has_residual_chlorine_override = coalesce((p_asset ->> 'has_residual_chlorine_override')::boolean, old_a.has_residual_chlorine_override),
    residual_chlorine_override = case
      when coalesce((p_asset ->> 'has_residual_chlorine_override')::boolean, old_a.has_residual_chlorine_override)
      then coalesce(nullif(p_asset ->> 'residual_chlorine_override', '')::numeric, old_a.residual_chlorine_override)
      else null
    end,
    version = old_a.version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where id = old_a.id
  returning * into new_a;

  -- 7.3.4: deactivating the default transfers it to the first active asset by code
  if old_a.is_default and not new_a.is_default and new_a.status = 'inactive' then
    select id into replacement_id
    from public.assets
    where category_id = old_a.category_id and status = 'active' and id <> old_a.id
    order by asset_code asc
    limit 1
    for update;

    if replacement_id is not null then
      update public.assets
      set is_default = true, version = version + 1, updated_at = now(), updated_by = auth.uid()
      where id = replacement_id;

      insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
      values (replacement_id, 'default_transferred', 'asset', replacement_id, 'تعيين تلقائي كأصل افتراضي بعد تعطيل السابق', auth.uid());
    end if;
  end if;

  if p_values is not null and p_values <> '{}'::jsonb then
    perform public.validate_and_save_dynamic_values(new_a.category_id, 'asset', new_a.id, p_values, new_a.created_at);
  end if;

  insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, description, created_by)
  values (
    new_a.id,
    case
      when old_a.status <> new_a.status and new_a.status = 'inactive' then 'asset_deactivated'
      when old_a.status <> new_a.status and new_a.status = 'active' then 'asset_reactivated'
      else 'asset_updated'
    end,
    'asset',
    new_a.id,
    case
      when old_a.status <> new_a.status and new_a.status = 'inactive' then 'تعطيل الأصل ' || new_a.asset_code
      when old_a.status <> new_a.status and new_a.status = 'active' then 'إعادة تفعيل الأصل ' || new_a.asset_code
      else 'تعديل بيانات الأصل ' || new_a.asset_code
    end,
    new_a.name,
    auth.uid()
  );

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'update', 'asset', new_a.id, to_jsonb(old_a), to_jsonb(new_a));

  return new_a;
end;
$$;

create or replace function public.set_default_asset(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assets;
  prev_default public.assets;
  v_cat uuid;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select category_id into v_cat from public.assets where id = p_asset_id;
  if v_cat is null then
    raise exception 'الأصل غير موجود';
  end if;
  perform 1 from public.categories where id = v_cat for update;

  select * into a from public.assets where id = p_asset_id for update;
  if a.status <> 'active' then
    raise exception 'لا يمكن تعيين أصل غير نشط كأصل افتراضي';
  end if;
  if a.is_default then
    return;
  end if;

  select * into prev_default
  from public.assets
  where category_id = a.category_id and is_default = true and id <> a.id
  for update;

  if prev_default.id is not null then
    update public.assets
    set is_default = false, updated_at = now(), updated_by = auth.uid(), version = version + 1
    where id = prev_default.id;

    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (prev_default.id, 'default_unset', 'asset', prev_default.id, 'إلغاء التعيين كأصل افتراضي', auth.uid());
  end if;

  update public.assets
  set is_default = true, updated_at = now(), updated_by = auth.uid(), version = version + 1
  where id = a.id;

  insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
  values (a.id, 'default_set', 'asset', a.id, 'تعيين كأصل افتراضي للتصنيف', auth.uid());

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'set_default', 'asset', a.id, to_jsonb(prev_default), to_jsonb(a));
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Global search: SQL search_path pinned, LIKE wildcards escaped, empty
--    query returns nothing, dynamic values of all 5 types incl. option labels.
-- ---------------------------------------------------------------------
create or replace function public.aoms_value_text(
  p_text text, p_number numeric, p_date date, p_bool boolean, p_option uuid
) returns text language sql stable security invoker set search_path = public as $$
  select concat_ws(' ', p_text, p_number::text, p_date::text,
    case when p_bool is true then 'نعم true' when p_bool is false then 'لا false' end,
    (select o.label || ' ' || o.value_key from public.category_field_options o where o.id = p_option))
$$;

drop function if exists public.global_search(text);
create function public.global_search(p_query text)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  asset_id uuid,
  tab_key text,
  record_id uuid
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
  pat text;
begin
  if q = '' or not public.is_active_user() then
    return;
  end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select 'category'::text, c.id, c.code_prefix || ' | ' || c.name, coalesce(c.description, ''), null::uuid, 'categories'::text, c.id
  from public.categories c
  where concat_ws(' ', c.code_prefix, c.name, c.description) ilike pat
  union all
  select 'asset'::text, a.id, a.asset_code || ' | ' || a.name, coalesce(a.location, ''), a.id, 'assets'::text, a.id
  from public.assets a
  where concat_ws(' ', a.asset_code, a.name, a.location, a.notes) ilike pat
     or exists (
       select 1 from public.asset_field_values v
       where v.asset_id = a.id
         and public.aoms_value_text(v.value_text, v.value_number, v.value_date, v.value_boolean, v.value_option_id) ilike pat
     )
  union all
  select 'operator'::text, o.id, o.name, coalesce(o.phone, ''), null::uuid, 'operators'::text, o.id
  from public.operators o
  where concat_ws(' ', o.name, o.phone, o.notes) ilike pat
  union all
  select 'operation_log'::text, l.id, a.asset_code || ' — تشغيل ' || l.operation_date::text, coalesce(l.notes, ''), l.asset_id, 'operation_logs'::text, l.id
  from public.operation_logs l
  join public.assets a on a.id = l.asset_id
  where concat_ws(' ', a.asset_code, a.name, l.operation_date::text, l.notes) ilike pat
     or exists (
       select 1 from public.operation_log_values v
       where v.operation_log_id = l.id
         and public.aoms_value_text(v.value_text, v.value_number, v.value_date, v.value_boolean, v.value_option_id) ilike pat
     )
  union all
  select 'fuel_transaction'::text, f.id, a.asset_code || ' — وقود ' || f.transaction_date::text, coalesce(f.supplier, f.notes, ''), f.asset_id, 'fuel_transactions'::text, f.id
  from public.fuel_transactions f
  join public.assets a on a.id = f.asset_id
  where concat_ws(' ', a.asset_code, a.name, f.transaction_date::text, f.supplier, f.invoice_number, f.adjustment_reason, f.notes) ilike pat
  union all
  select 'chlorine_transaction'::text, ch.id, a.asset_code || ' — كلور ' || ch.transaction_date::text, coalesce(ch.supplier, ch.notes, ''), ch.asset_id, 'chlorine_transactions'::text, ch.id
  from public.chlorine_transactions ch
  join public.assets a on a.id = ch.asset_id
  where concat_ws(' ', a.asset_code, a.name, ch.transaction_date::text, ch.supplier, ch.adjustment_reason, ch.notes) ilike pat;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Backup: export the timeline too; restore keeps referential integrity
--     when profile ids differ (unknown authors -> null), restores
--     app_settings and timeline, and re-validates balances before commit.
-- ---------------------------------------------------------------------
create or replace function public.aoms_strip_unknown_profiles(p_rows jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    e
    || case when e ? 'created_by' and not exists (select 1 from public.profiles p where p.id::text = e ->> 'created_by')
            then jsonb_build_object('created_by', null) else '{}'::jsonb end
    || case when e ? 'updated_by' and not exists (select 1 from public.profiles p where p.id::text = e ->> 'updated_by')
            then jsonb_build_object('updated_by', null) else '{}'::jsonb end
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
$$;

create or replace function public.export_aoms_backup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'النسخ الاحتياطي متاح لمدير النظام فقط';
  end if;

  return jsonb_build_object(
    'schema_version', '2.0.0',
    'exported_at', now(),
    'categories', coalesce((select jsonb_agg(x order by x.code_prefix) from public.categories x), '[]'::jsonb),
    'category_fields', coalesce((select jsonb_agg(x order by x.sort_order) from public.category_fields x), '[]'::jsonb),
    'category_field_options', coalesce((select jsonb_agg(x order by x.sort_order) from public.category_field_options x), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(x order by x.asset_code) from public.assets x), '[]'::jsonb),
    'asset_field_values', coalesce((select jsonb_agg(x) from public.asset_field_values x), '[]'::jsonb),
    'operators', coalesce((select jsonb_agg(x order by x.name) from public.operators x), '[]'::jsonb),
    'operation_logs', coalesce((select jsonb_agg(x order by x.operation_date asc) from public.operation_logs x), '[]'::jsonb),
    'operation_log_values', coalesce((select jsonb_agg(x) from public.operation_log_values x), '[]'::jsonb),
    'fuel_types', coalesce((select jsonb_agg(x order by x.name) from public.fuel_types x), '[]'::jsonb),
    'fuel_transactions', coalesce((select jsonb_agg(x order by x.transaction_date asc) from public.fuel_transactions x), '[]'::jsonb),
    'chlorine_transactions', coalesce((select jsonb_agg(x order by x.transaction_date asc) from public.chlorine_transactions x), '[]'::jsonb),
    'timeline_events', coalesce((select jsonb_agg(x order by x.created_at asc) from public.timeline_events x), '[]'::jsonb),
    'app_settings', coalesce((select jsonb_agg(x) from public.app_settings x), '[]'::jsonb),
    'profiles', coalesce(
      (select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'full_name', full_name, 'role', role, 'status', status)) from public.profiles),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.restore_aoms_backup(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
  k text;
  v_bad uuid;
begin
  if not public.is_admin() then
    raise exception 'استعادة النسخة الاحتياطية متاحة لمدير النظام فقط';
  end if;
  if p_backup is null or jsonb_typeof(p_backup) <> 'object' then
    raise exception 'بنية ملف النسخة الاحتياطية غير صالحة';
  end if;
  if coalesce(p_backup ->> 'schema_version', '') not in ('2.0', '2.0.0') then
    raise exception 'إصدار المخطط غير مدعوم في هذا الملف';
  end if;
  foreach k in array array['categories','category_fields','category_field_options','assets','asset_field_values','operators',
                           'operation_logs','operation_log_values','fuel_types','fuel_transactions','chlorine_transactions'] loop
    if jsonb_typeof(p_backup -> k) is distinct from 'array' then
      raise exception 'ملف النسخة الاحتياطية يفتقر إلى الجدول المطلوب: %', k;
    end if;
  end loop;

  perform set_config('aoms.in_restore', 'true', true);

  delete from public.operation_log_values;
  delete from public.operation_logs;
  delete from public.fuel_transactions;
  delete from public.chlorine_transactions;
  delete from public.asset_field_values;
  delete from public.timeline_events;
  delete from public.assets;
  delete from public.category_field_options;
  delete from public.category_fields;
  delete from public.categories;
  delete from public.operators;
  delete from public.fuel_types;

  insert into public.categories select * from jsonb_populate_recordset(null::public.categories, public.aoms_strip_unknown_profiles(p_backup -> 'categories'));
  insert into public.category_fields select * from jsonb_populate_recordset(null::public.category_fields, public.aoms_strip_unknown_profiles(p_backup -> 'category_fields'));
  insert into public.category_field_options select * from jsonb_populate_recordset(null::public.category_field_options, public.aoms_strip_unknown_profiles(p_backup -> 'category_field_options'));
  insert into public.operators select * from jsonb_populate_recordset(null::public.operators, public.aoms_strip_unknown_profiles(p_backup -> 'operators'));
  insert into public.fuel_types select * from jsonb_populate_recordset(null::public.fuel_types, public.aoms_strip_unknown_profiles(p_backup -> 'fuel_types'));
  insert into public.assets select * from jsonb_populate_recordset(null::public.assets, public.aoms_strip_unknown_profiles(p_backup -> 'assets'));
  insert into public.asset_field_values select * from jsonb_populate_recordset(null::public.asset_field_values, public.aoms_strip_unknown_profiles(p_backup -> 'asset_field_values'));
  insert into public.operation_logs select * from jsonb_populate_recordset(null::public.operation_logs, public.aoms_strip_unknown_profiles(p_backup -> 'operation_logs'));
  insert into public.operation_log_values select * from jsonb_populate_recordset(null::public.operation_log_values, public.aoms_strip_unknown_profiles(p_backup -> 'operation_log_values'));
  insert into public.fuel_transactions select * from jsonb_populate_recordset(null::public.fuel_transactions, public.aoms_strip_unknown_profiles(p_backup -> 'fuel_transactions'));
  insert into public.chlorine_transactions select * from jsonb_populate_recordset(null::public.chlorine_transactions, public.aoms_strip_unknown_profiles(p_backup -> 'chlorine_transactions'));

  if jsonb_typeof(p_backup -> 'timeline_events') = 'array' then
    insert into public.timeline_events
    select * from jsonb_populate_recordset(null::public.timeline_events, public.aoms_strip_unknown_profiles(p_backup -> 'timeline_events')) t
    where t.asset_id is null or exists (select 1 from public.assets a where a.id = t.asset_id);
  end if;

  if jsonb_typeof(p_backup -> 'app_settings') = 'array' then
    insert into public.app_settings (key, value, updated_by, updated_at)
    select s.key, s.value, null, now()
    from jsonb_populate_recordset(null::public.app_settings, p_backup -> 'app_settings') s
    where s.key is not null and s.value is not null and s.key <> 'schema_version'
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;

  -- domain re-validation of the restored ledger (all-or-nothing)
  select asset_id into v_bad from public.asset_fuel_balances where balance < 0 limit 1;
  if v_bad is not null then
    raise exception 'النسخة الاحتياطية تنتج رصيد وقود سالبًا للأصل %', v_bad;
  end if;
  select asset_id into v_bad from public.asset_chlorine_balances where balance < 0 limit 1;
  if v_bad is not null then
    raise exception 'النسخة الاحتياطية تنتج رصيد كلور سالبًا للأصل %', v_bad;
  end if;
  select category_id into v_bad from public.assets where is_default and status = 'active' group by category_id having count(*) > 1 limit 1;
  if v_bad is not null then
    raise exception 'النسخة الاحتياطية تحتوي أكثر من أصل افتراضي للتصنيف %', v_bad;
  end if;

  perform set_config('aoms.in_restore', 'false', true);

  v_counts := jsonb_build_object(
    'categories', jsonb_array_length(p_backup -> 'categories'),
    'category_fields', jsonb_array_length(p_backup -> 'category_fields'),
    'assets', jsonb_array_length(p_backup -> 'assets'),
    'operators', jsonb_array_length(p_backup -> 'operators'),
    'operation_logs', jsonb_array_length(p_backup -> 'operation_logs'),
    'fuel_transactions', jsonb_array_length(p_backup -> 'fuel_transactions'),
    'chlorine_transactions', jsonb_array_length(p_backup -> 'chlorine_transactions')
  );

  insert into public.audit_logs (user_id, action, entity_type, after_json)
  values (auth.uid(), 'restore_backup', 'system', v_counts);
  insert into public.timeline_events (event_type, entity_type, title, metadata, created_by)
  values ('backup_restored', 'system', 'استعادة شاملة للنسخة الاحتياطية', v_counts, auth.uid());

  return v_counts;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Local business day for every date rule (OPLOG-003/008/009, FUEL, CHL)
-- ---------------------------------------------------------------------
alter function public.save_operation_log(jsonb, jsonb) set timezone = 'Asia/Jerusalem';
alter function public.save_fuel_transaction(jsonb) set timezone = 'Asia/Jerusalem';
alter function public.save_chlorine_transaction(jsonb) set timezone = 'Asia/Jerusalem';
alter function public.restore_aoms_backup(jsonb) set timezone = 'Asia/Jerusalem';
insert into public.app_settings (key, value) values ('business_timezone', '"Asia/Jerusalem"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 12. Realtime: tables must be in the supabase_realtime publication or
--     postgres_changes never fires (SYNC-006/007).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','categories','category_fields','category_field_options','assets','asset_field_values',
                             'operators','operation_logs','operation_log_values','fuel_types','fuel_transactions',
                             'chlorine_transactions','timeline_events','audit_logs','app_settings'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 13. Re-grant only what the client needs.
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.categories, public.category_fields, public.category_field_options,
  public.operators, public.fuel_types, public.app_settings, public.profiles to authenticated;
revoke insert on public.profiles from authenticated; -- profiles are created by the auth.users trigger
grant execute on function
  public.current_profile(), public.is_active_user(), public.is_admin(), public.can_operate(),
  public.create_asset(jsonb, jsonb), public.update_asset(uuid, bigint, jsonb, jsonb), public.set_default_asset(uuid),
  public.save_operation_log(jsonb, jsonb), public.delete_operation_log(uuid, bigint),
  public.save_fuel_transaction(jsonb), public.delete_fuel_transaction(uuid, bigint),
  public.save_chlorine_transaction(jsonb), public.delete_chlorine_transaction(uuid, bigint),
  public.global_search(text), public.aoms_value_text(text, numeric, date, boolean, uuid),
  public.export_aoms_backup(), public.restore_aoms_backup(jsonb)
to authenticated;
revoke execute on function
  public.validate_and_save_dynamic_values(uuid, public.field_scope, uuid, jsonb, timestamptz),
  public.aoms_strip_unknown_profiles(jsonb),
  public.handle_new_auth_user(),
  public.trg_stamp_row_fn(), public.trg_audit_admin_entity_fn(), public.trg_audit_immutable_fn(),
  public.trg_timeline_append_only_fn(), public.trg_protect_profiles_fn(), public.trg_ledger_guard_fn(),
  public.trg_assert_balances_fn(), public.trg_protect_categories_fn(), public.trg_protect_category_fields_fn(),
  public.trg_protect_field_options_fn(), public.trg_prevent_entity_delete_fn()
from authenticated;

insert into public.app_settings (key, value) values ('schema_migration', '"202610260003"'::jsonb)
on conflict (key) do update set value = excluded.value;

commit;
