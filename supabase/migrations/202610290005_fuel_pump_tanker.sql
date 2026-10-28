-- =====================================================================
-- AOMS V2 — Migration 005: single fuel tank per asset, pump capacity,
-- pump→tanker link, water split (tankers vs network).
--
-- Additive and backward compatible:
--  * only new NULLABLE columns (restore_aoms_backup inserts every column, so
--    older backups without these keys still restore — missing keys become NULL
--    and NULL is read as 0 / "none" everywhere);
--  * no table or row is dropped or deleted;
--  * the existing RPC signatures are unchanged (old clients keep working —
--    keys they do not send keep the stored value / the asset default).
--
-- Model ("خزان واحد لكل أصل"):
--  * assets.fuel_type_id IS the asset's single tank (NULL = بدون وقود). A
--    column — not a child table — so "one tank per asset" holds by
--    construction. Refills/adjustments (fuel_transactions) and consumption
--    (operation_logs.fuel_consumed = hours × asset fuel rate) are bound to
--    that tank by triggers.
--  * categories.asset_kind: general | pump | tanker.
--  * pumps: assets.pump_capacity (م³/ساعة, required > 0) and
--    assets.default_tanker_id (changeable per log).
--  * operation_logs: pump_capacity_snapshot, water_total, tanker_id,
--    trips_count, distributed_quantity, network_quantity
--    (network = total − distributed, distributed ≤ total).
-- =====================================================================
begin;

-- ---------------------------------------------------------------- columns
alter table public.categories
  add column if not exists asset_kind text default 'general';
alter table public.categories drop constraint if exists categories_asset_kind_chk;
alter table public.categories
  add constraint categories_asset_kind_chk
  check (asset_kind is null or asset_kind in ('general', 'pump', 'tanker'));

alter table public.assets
  add column if not exists fuel_type_id uuid references public.fuel_types(id),
  add column if not exists pump_capacity numeric,
  add column if not exists default_tanker_id uuid references public.assets(id);
alter table public.assets drop constraint if exists assets_pump_capacity_chk;
alter table public.assets
  add constraint assets_pump_capacity_chk check (pump_capacity is null or pump_capacity > 0);
alter table public.assets drop constraint if exists assets_default_tanker_not_self_chk;
alter table public.assets
  add constraint assets_default_tanker_not_self_chk check (default_tanker_id is null or default_tanker_id <> id);
create index if not exists assets_fuel_type_idx on public.assets(fuel_type_id);

alter table public.operation_logs
  add column if not exists pump_capacity_snapshot numeric,
  add column if not exists water_total numeric,
  add column if not exists tanker_id uuid references public.assets(id),
  add column if not exists trips_count integer default 0,
  add column if not exists distributed_quantity numeric default 0,
  add column if not exists network_quantity numeric;
alter table public.operation_logs drop constraint if exists operation_logs_water_chk;
alter table public.operation_logs
  add constraint operation_logs_water_chk check (
    coalesce(trips_count, 0) >= 0
    and coalesce(distributed_quantity, 0) >= 0
    and coalesce(water_total, 0) >= 0
    and (pump_capacity_snapshot is null or pump_capacity_snapshot > 0)
    and coalesce(distributed_quantity, 0) <= coalesce(water_total, 0)
  );
create index if not exists operation_logs_tanker_idx on public.operation_logs(tanker_id);

-- category kind mapping for the existing deployment (PMP = مضخات, TRK = صهاريج)
update public.categories set asset_kind = 'pump'
 where code_prefix = 'PMP' and coalesce(asset_kind, 'general') = 'general';
update public.categories set asset_kind = 'tanker'
 where code_prefix = 'TRK' and coalesce(asset_kind, 'general') = 'general';

-- ------------------------------------------------------- tank balance view
-- One row per asset that has a tank (fuel_type_id). Kept next to the legacy
-- asset_fuel_balances view (asset × fuel type) which old clients still read.
create or replace view public.asset_fuel_tanks with (security_invoker = true) as
select
  a.id as asset_id,
  a.asset_code,
  a.fuel_type_id,
  coalesce(s.supplied, 0) as supplied,
  coalesce(s.adjusted_plus, 0) as adjusted_plus,
  coalesce(s.adjusted_minus, 0) as adjusted_minus,
  coalesce(u.consumed, 0) as consumed,
  coalesce(s.supplied, 0) + coalesce(s.adjusted_plus, 0) - coalesce(s.adjusted_minus, 0) - coalesce(u.consumed, 0) as balance
from public.assets a
left join lateral (
  select
    sum(case when t.transaction_type = 'supply' then t.quantity else 0 end) as supplied,
    sum(case when t.transaction_type = 'adjustment_plus' then t.quantity else 0 end) as adjusted_plus,
    sum(case when t.transaction_type = 'adjustment_minus' then t.quantity else 0 end) as adjusted_minus
  from public.fuel_transactions t
  where t.asset_id = a.id and t.fuel_type_id = a.fuel_type_id
) s on true
left join lateral (
  select sum(o.fuel_consumed) as consumed
  from public.operation_logs o
  where o.asset_id = a.id and (o.fuel_type_id = a.fuel_type_id or o.fuel_type_id is null)
) u on true
where a.fuel_type_id is not null;

grant select on public.asset_fuel_tanks to authenticated;

-- ------------------------------------------------------------- guards
create or replace function public.trg_asset_tank_guard_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.categories;
  v_kind text;
  t_kind text;
  t_status public.entity_status;
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return new;
  end if;
  select * into c from public.categories where id = new.category_id;
  v_kind := coalesce(c.asset_kind, 'general');

  if new.fuel_type_id is not null and (tg_op = 'INSERT' or new.fuel_type_id is distinct from old.fuel_type_id) then
    if not c.supports_fuel then
      raise exception 'تصنيف هذا الأصل لا يدعم الوقود؛ اختر "بدون وقود"';
    end if;
    if not exists (select 1 from public.fuel_types where id = new.fuel_type_id and status = 'active') then
      raise exception 'نوع الوقود المحدد للخزان غير موجود أو غير نشط';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.fuel_type_id is distinct from old.fuel_type_id then
    if exists (select 1 from public.fuel_transactions
                where asset_id = new.id and fuel_type_id is distinct from new.fuel_type_id)
       or exists (select 1 from public.operation_logs
                   where asset_id = new.id and fuel_consumed > 0 and fuel_type_id is distinct from new.fuel_type_id) then
      raise exception 'لا يمكن تغيير نوع وقود الخزان أو إزالته بعد تسجيل حركات أو استهلاك عليه';
    end if;
  end if;

  if v_kind = 'pump'
     and (tg_op = 'INSERT' or new.pump_capacity is distinct from old.pump_capacity)
     and (new.pump_capacity is null or new.pump_capacity <= 0) then
    raise exception 'قدرة المضخة (م³/ساعة) مطلوبة ويجب أن تكون أكبر من صفر';
  end if;

  if new.default_tanker_id is not null
     and (tg_op = 'INSERT' or new.default_tanker_id is distinct from old.default_tanker_id) then
    select coalesce(tc.asset_kind, 'general'), ta.status into t_kind, t_status
      from public.assets ta join public.categories tc on tc.id = ta.category_id
     where ta.id = new.default_tanker_id;
    if t_kind is distinct from 'tanker' or t_status <> 'active' or new.default_tanker_id = new.id then
      raise exception 'الصهريج الافتراضي يجب أن يكون أصلًا نشطًا من نوع صهريج';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asset_tank_guard on public.assets;
create trigger trg_asset_tank_guard
before insert or update on public.assets
for each row execute function public.trg_asset_tank_guard_fn();

-- every refill / adjustment goes into the asset's single tank
create or replace function public.trg_fuel_tx_single_tank_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tank uuid;
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return new;
  end if;
  select fuel_type_id into v_tank from public.assets where id = new.asset_id;
  if v_tank is null then
    raise exception 'هذا الأصل بلا خزان وقود؛ حدّد نوع الوقود في بطاقة الأصل أولًا';
  end if;
  if new.fuel_type_id is distinct from v_tank then
    raise exception 'نوع الوقود في الحركة يجب أن يطابق خزان الأصل (خزان واحد لكل أصل)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fuel_tx_single_tank on public.fuel_transactions;
create trigger trg_fuel_tx_single_tank
before insert or update of asset_id, fuel_type_id on public.fuel_transactions
for each row execute function public.trg_fuel_tx_single_tank_fn();

-- consumption is always charged to the asset's tank (none when بدون وقود)
create or replace function public.trg_oplog_single_tank_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tank uuid;
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return new;
  end if;
  select fuel_type_id into v_tank from public.assets where id = new.asset_id;
  if v_tank is null then
    if coalesce(new.fuel_consumed, 0) > 0 then
      raise exception 'لا يمكن تسجيل استهلاك وقود لأصل بلا خزان وقود';
    end if;
    new.fuel_type_id := null;
  else
    new.fuel_type_id := v_tank;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_oplog_single_tank on public.operation_logs;
create trigger trg_oplog_single_tank
before insert or update on public.operation_logs
for each row execute function public.trg_oplog_single_tank_fn();

-- a fuel type linked to a tank can be deactivated but never deleted
create or replace function public.trg_prevent_entity_delete_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return old;
  end if;
  if tg_table_name = 'fuel_types' then
    if exists (select 1 from public.fuel_transactions where fuel_type_id = old.id)
       or exists (select 1 from public.operation_logs where fuel_type_id = old.id) then
      raise exception 'لا يسمح بحذف نوع وقود مستخدم؛ استخدم التعطيل';
    end if;
    if exists (select 1 from public.assets where fuel_type_id = old.id) then
      raise exception 'لا يسمح بحذف نوع وقود مرتبط بخزان أصل؛ استخدم التعطيل';
    end if;
    return old;
  end if;
  raise exception 'الحذف المادي غير مسموح لهذا الكيان؛ استخدم التعطيل';
end;
$$;

-- category kind cannot change once the category has assets
create or replace function public.trg_category_kind_guard_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('aoms.in_restore', true) = 'true' then
    return new;
  end if;
  if coalesce(new.asset_kind, 'general') is distinct from coalesce(old.asset_kind, 'general')
     and exists (select 1 from public.assets where category_id = old.id) then
    raise exception 'لا يمكن تغيير نوع التصنيف (عام/مضخة/صهريج) بعد إضافة أصول له';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_category_kind_guard on public.categories;
create trigger trg_category_kind_guard
before update on public.categories
for each row execute function public.trg_category_kind_guard_fn();

-- ------------------------------------------------------------- create_asset
create or replace function public.create_asset(p_asset jsonb, p_values jsonb default '{}'::jsonb)
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
  is_pump boolean;
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
  is_pump := coalesce(c.asset_kind, 'general') = 'pump';

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
    fuel_type_id, pump_capacity, default_tanker_id,
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
    case when c.supports_fuel then nullif(p_asset ->> 'fuel_type_id', '')::uuid end,
    case when is_pump then nullif(p_asset ->> 'pump_capacity', '')::numeric end,
    case when is_pump then nullif(p_asset ->> 'default_tanker_id', '')::uuid end,
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

-- ------------------------------------------------------------- update_asset
-- keys absent from p_asset keep their stored value (old clients unaffected)
create or replace function public.update_asset(p_id uuid, p_version bigint, p_asset jsonb, p_values jsonb default '{}'::jsonb)
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
  c public.categories;
  is_pump boolean;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select category_id into v_cat from public.assets where id = p_id;
  if v_cat is null then
    raise exception 'الأصل غير موجود';
  end if;
  -- category row lock serializes every default-asset change in this category
  select * into c from public.categories where id = v_cat for update;
  is_pump := coalesce(c.asset_kind, 'general') = 'pump';

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
    fuel_type_id = case
      when p_asset ? 'fuel_type_id' then nullif(p_asset ->> 'fuel_type_id', '')::uuid
      else old_a.fuel_type_id
    end,
    pump_capacity = case
      when is_pump and p_asset ? 'pump_capacity' then nullif(p_asset ->> 'pump_capacity', '')::numeric
      else old_a.pump_capacity
    end,
    default_tanker_id = case
      when is_pump and p_asset ? 'default_tanker_id' then nullif(p_asset ->> 'default_tanker_id', '')::uuid
      else old_a.default_tanker_id
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

-- -------------------------------------------------------- save_operation_log
create or replace function public.save_operation_log(p_log jsonb, p_values jsonb default '{}'::jsonb)
returns public.operation_logs
language plpgsql
security definer
set search_path = public
set "TimeZone" to 'Asia/Jerusalem'
as $$
declare
  a public.assets;
  c public.categories;
  op public.operators;
  editing boolean;
  target_id uuid;
  old_log public.operation_logs;
  latest_log public.operation_logs;
  prev_log public.operation_logs;
  r public.operation_logs;
  op_date date;
  rec_type public.operation_record_type;
  prev_read numeric;
  curr_read numeric;
  usage numeric;
  rate numeric;
  fuel_cons numeric;
  chl_cons numeric;
  res_chl numeric;
  v_fuel_type_id uuid;
  v_fuel_bal numeric;
  v_chl_bal numeric;
  -- pump / tanker
  is_pump boolean;
  v_cap numeric;
  v_water numeric;
  v_tanker uuid;
  v_trips numeric;
  v_dist numeric;
  v_net numeric;
  t_kind text;
  t_status public.entity_status;
begin
  if not public.can_operate() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  target_id := nullif(p_log ->> 'id', '')::uuid;
  editing := target_id is not null;

  if editing then
    select * into old_log from public.operation_logs where id = target_id for update;
    if old_log.id is null then
      raise exception 'السجل المطلوب تعديله غير موجود';
    end if;
    if (p_log ->> 'asset_id') is not null and (p_log ->> 'asset_id')::uuid <> old_log.asset_id then
      raise exception 'لا يمكن تغيير الأصل أثناء تعديل سجل التشغيل';
    end if;
    if (p_log ->> 'version') is not null and old_log.version <> (p_log ->> 'version')::bigint then
      raise exception 'تعارض إصدار: تم تعديل السجل من جهاز آخر (الإصدار الحالي: %)', old_log.version;
    end if;
    select * into a from public.assets where id = old_log.asset_id for update;
    select * into latest_log from public.operation_logs where asset_id = a.id order by operation_date desc, created_at desc limit 1;
    if latest_log.id <> old_log.id then
      raise exception 'لا يمكن تعديل سوى آخر سجل تشغيل للأصل';
    end if;
    select * into prev_log from public.operation_logs where asset_id = a.id and id <> old_log.id order by operation_date desc, created_at desc limit 1;
  else
    select * into a from public.assets where id = (p_log ->> 'asset_id')::uuid for update;
    if a.id is null or a.status <> 'active' then
      raise exception 'لا يمكن إضافة سجل تشغيل لأصل غير نشط';
    end if;
    select * into prev_log from public.operation_logs where asset_id = a.id order by operation_date desc, created_at desc limit 1;
  end if;

  select * into c from public.categories where id = a.category_id;
  op_date := (p_log ->> 'operation_date')::date;

  if op_date > current_date then
    raise exception 'لا يسمح بتاريخ مستقبلي';
  end if;

  if not editing and prev_log.id is not null and prev_log.operation_date >= current_date then
    raise exception 'يوجد سجل بتاريخ اليوم لهذا الأصل، ولا يمكن إضافة سجل جديد حتى اليوم التالي';
  end if;

  if c.uses_meter and prev_log.id is not null and op_date <= prev_log.operation_date then
    raise exception 'يجب أن يكون تاريخ السجل بعد تاريخ آخر سجل سابق (%)', prev_log.operation_date;
  end if;

  if nullif(p_log ->> 'operator_id', '') is not null then
    select * into op from public.operators where id = (p_log ->> 'operator_id')::uuid;
    if op.id is null then
      raise exception 'المشغل المحدد غير موجود';
    end if;
    if op.status <> 'active' and (not editing or old_log.operator_id is distinct from op.id) then
      raise exception 'لا يمكن اختيار مشغل غير نشط في سجل جديد';
    end if;
  end if;

  rec_type := coalesce(nullif(p_log ->> 'record_type', '')::public.operation_record_type, 'daily');

  if c.uses_meter then
    prev_read := coalesce(prev_log.current_reading, nullif(p_log ->> 'previous_reading', '')::numeric);
    curr_read := nullif(p_log ->> 'current_reading', '')::numeric;
    if prev_read is null or curr_read is null or prev_read < 0 or curr_read < 0 then
      raise exception 'قراءات العداد مطلوبة ويجب أن تكون أرقامًا غير سالبة';
    end if;
    if rec_type = 'meter_reset' then
      usage := case when curr_read >= prev_read then round(curr_read - prev_read, 2) else 0 end;
    else
      if curr_read < prev_read then
        raise exception 'القراءة الحالية لا تقل عن السابقة في السجل اليومي';
      end if;
      usage := round(curr_read - prev_read, 2);
    end if;
  else
    prev_read := null;
    curr_read := null;
    usage := null;
  end if;

  -- single tank: consumption = hours × fuel per hour (asset card), charged to the asset's tank only
  rate := case when a.has_fuel_rate_override then a.fuel_rate_override else c.default_fuel_rate end;
  v_fuel_type_id := a.fuel_type_id;
  fuel_cons := case
    when c.supports_fuel and c.uses_meter and usage is not null and v_fuel_type_id is not null
      then round(usage * coalesce(rate, 0), 2)
    else 0
  end;

  if fuel_cons > 0 then
    select balance into v_fuel_bal from public.asset_fuel_tanks where asset_id = a.id;
    if coalesce(v_fuel_bal, 0) + coalesce(old_log.fuel_consumed, 0) - fuel_cons < 0 then
      raise exception 'الرصيد النظري لخزان الوقود لا يكفي لتغطية الاستهلاك المحسوب (%)', fuel_cons;
    end if;
  end if;

  if c.supports_chlorine then
    chl_cons := coalesce(
      nullif(p_log ->> 'chlorine_consumed', '')::numeric,
      case when a.has_chlorine_consumption_override then a.chlorine_consumption_override else c.default_chlorine_consumption end,
      0
    );
    res_chl := coalesce(
      nullif(p_log ->> 'residual_chlorine', '')::numeric,
      case when a.has_residual_chlorine_override then a.residual_chlorine_override else c.default_residual_chlorine end
    );
    if chl_cons < 0 then
      raise exception 'استهلاك الكلور لا يمكن أن يكون سالبًا';
    end if;
    if chl_cons > 0 then
      select balance into v_chl_bal from public.asset_chlorine_balances where asset_id = a.id;
      if coalesce(v_chl_bal, 0) + coalesce(old_log.chlorine_consumed, 0) - chl_cons < 0 then
        raise exception 'الرصيد النظري للكلور لا يكفي لتغطية الاستهلاك (%)', chl_cons;
      end if;
    end if;
  else
    chl_cons := 0;
    res_chl := null;
  end if;

  -- pump water: total = hours × capacity snapshot; network = total − distributed (to tankers)
  is_pump := coalesce(c.asset_kind, 'general') = 'pump';
  if is_pump then
    v_cap := case when editing then coalesce(old_log.pump_capacity_snapshot, a.pump_capacity) else a.pump_capacity end;
    if v_cap is null or v_cap <= 0 then
      raise exception 'قدرة المضخة (م³/ساعة) غير محددة في بطاقة الأصل';
    end if;
    v_water := round(coalesce(usage, 0) * v_cap, 2);

    if p_log ? 'tanker_id' then
      v_tanker := nullif(p_log ->> 'tanker_id', '')::uuid;
    elsif editing then
      v_tanker := old_log.tanker_id;
    else
      v_tanker := a.default_tanker_id;
    end if;
    v_trips := case
      when p_log ? 'trips_count' then coalesce(nullif(p_log ->> 'trips_count', '')::numeric, 0)
      when editing then coalesce(old_log.trips_count, 0)
      else 0
    end;
    v_dist := case
      when p_log ? 'distributed_quantity' then coalesce(nullif(p_log ->> 'distributed_quantity', '')::numeric, 0)
      when editing then coalesce(old_log.distributed_quantity, 0)
      else 0
    end;
    if v_trips < 0 or v_trips <> trunc(v_trips) then
      raise exception 'عدد النقلات يجب أن يكون عددًا صحيحًا غير سالب';
    end if;
    if v_dist < 0 then
      raise exception 'الكمية الموزعة لا يمكن أن تكون سالبة';
    end if;
    if v_dist > v_water then
      raise exception 'الكمية الموزعة (%) لا يمكن أن تتجاوز إجمالي المياه (%)', v_dist, v_water;
    end if;
    if (v_trips > 0 or v_dist > 0) and v_tanker is null then
      raise exception 'يجب اختيار الصهريج عند تسجيل نقلات أو كمية موزعة';
    end if;
    if v_tanker is not null then
      select coalesce(tc.asset_kind, 'general'), ta.status into t_kind, t_status
        from public.assets ta join public.categories tc on tc.id = ta.category_id
       where ta.id = v_tanker;
      if t_kind is distinct from 'tanker' then
        raise exception 'الصهريج المحدد غير صالح';
      end if;
      if t_status <> 'active' and (not editing or old_log.tanker_id is distinct from v_tanker) then
        raise exception 'لا يمكن اختيار صهريج غير نشط';
      end if;
    end if;
    v_net := round(v_water - v_dist, 2);
  else
    v_cap := null; v_water := null; v_tanker := null; v_trips := null; v_dist := null; v_net := null;
  end if;

  if editing then
    update public.operation_logs
    set
      operation_date = op_date,
      record_type = rec_type,
      operator_id = nullif(p_log ->> 'operator_id', '')::uuid,
      fuel_type_id = v_fuel_type_id,
      previous_reading = prev_read,
      current_reading = curr_read,
      usage_value = usage,
      effective_fuel_rate = case when c.supports_fuel then rate else null end,
      fuel_consumed = fuel_cons,
      chlorine_consumed = chl_cons,
      residual_chlorine = res_chl,
      pump_capacity_snapshot = v_cap,
      water_total = v_water,
      tanker_id = v_tanker,
      trips_count = v_trips::integer,
      distributed_quantity = v_dist,
      network_quantity = v_net,
      notes = p_log ->> 'notes',
      version = old_log.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where id = old_log.id
    returning * into r;

    perform public.validate_and_save_dynamic_values(c.id, 'operation', r.id, coalesce(p_values, '{}'::jsonb), r.created_at);

    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (a.id, 'operation_updated', 'operation_log', r.id, 'تعديل سجل تشغيل (' || r.operation_date || ')', auth.uid());

    insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
    values (auth.uid(), 'update', 'operation_log', r.id, to_jsonb(old_log), to_jsonb(r));
  else
    insert into public.operation_logs (
      asset_id, operation_date, record_type, operator_id, fuel_type_id,
      previous_reading, current_reading, usage_value, effective_fuel_rate,
      fuel_consumed, chlorine_consumed, residual_chlorine,
      pump_capacity_snapshot, water_total, tanker_id, trips_count, distributed_quantity, network_quantity,
      notes, created_by, updated_by
    )
    values (
      a.id, op_date, rec_type, nullif(p_log ->> 'operator_id', '')::uuid, v_fuel_type_id,
      prev_read, curr_read, usage, case when c.supports_fuel then rate else null end,
      fuel_cons, chl_cons, res_chl,
      v_cap, v_water, v_tanker, v_trips::integer, v_dist, v_net,
      p_log ->> 'notes', auth.uid(), auth.uid()
    )
    returning * into r;

    perform public.validate_and_save_dynamic_values(c.id, 'operation', r.id, coalesce(p_values, '{}'::jsonb), r.created_at);

    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (a.id, 'operation_created', 'operation_log', r.id, 'إضافة سجل تشغيل (' || r.operation_date || ')', auth.uid());

    insert into public.audit_logs (user_id, action, entity_type, entity_id, after_json)
    values (auth.uid(), 'create', 'operation_log', r.id, to_jsonb(r));
  end if;

  return r;
end;
$$;

-- ------------------------------------------------------------- privileges
revoke execute on function
  public.trg_asset_tank_guard_fn(),
  public.trg_fuel_tx_single_tank_fn(),
  public.trg_oplog_single_tank_fn(),
  public.trg_category_kind_guard_fn()
from public, anon, authenticated;
revoke execute on function public.create_asset(jsonb, jsonb), public.update_asset(uuid, bigint, jsonb, jsonb),
  public.save_operation_log(jsonb, jsonb) from public, anon;
grant execute on function public.create_asset(jsonb, jsonb), public.update_asset(uuid, bigint, jsonb, jsonb),
  public.save_operation_log(jsonb, jsonb) to authenticated;

insert into public.app_settings (key, value) values ('schema_migration', '"202610290005"'::jsonb)
on conflict (key) do update set value = excluded.value;

commit;
