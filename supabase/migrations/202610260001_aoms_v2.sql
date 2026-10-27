begin;

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'operator', 'viewer');
create type public.entity_status as enum ('active', 'inactive');
create type public.field_scope as enum ('asset', 'operation');
create type public.field_type as enum ('text', 'number', 'select', 'date', 'boolean');
create type public.transaction_type as enum ('supply', 'receipt', 'adjustment_plus', 'adjustment_minus');
create type public.operation_record_type as enum ('daily', 'meter_reset');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null check (nullif(trim(full_name), '') is not null),
  role public.user_role not null default 'viewer',
  status public.entity_status not null default 'active',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid()
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select status = 'active' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select status = 'active' and role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_operate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select status = 'active' and role in ('admin', 'operator') from public.profiles where id = auth.uid()), false)
$$;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(trim(name), '') is not null),
  code_prefix text not null unique check (code_prefix = upper(code_prefix) and code_prefix ~ '^[A-Z0-9_-]+$'),
  description text,
  status public.entity_status not null default 'active',
  uses_meter boolean not null default false,
  meter_unit text check (
    meter_unit is null or meter_unit in ('ساعة تشغيل', 'كيلومتر', 'متر مكعب', 'دورة تشغيل', 'عدد مرات التشغيل')
  ),
  supports_fuel boolean not null default false,
  supports_chlorine boolean not null default false,
  default_fuel_rate numeric check (default_fuel_rate is null or default_fuel_rate >= 0),
  fuel_unit text,
  default_chlorine_consumption numeric check (default_chlorine_consumption is null or default_chlorine_consumption >= 0),
  chlorine_unit text,
  default_residual_chlorine numeric check (default_residual_chlorine is null or default_residual_chlorine >= 0),
  next_asset_sequence bigint not null default 1 check (next_asset_sequence > 0),
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((uses_meter and meter_unit is not null) or (not uses_meter and meter_unit is null))
);

create table public.category_fields (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  scope public.field_scope not null,
  field_key text not null check (nullif(trim(field_key), '') is not null),
  label text not null check (nullif(trim(label), '') is not null),
  description text,
  field_type public.field_type not null,
  unit text,
  is_required boolean not null default false,
  required_since timestamptz,
  show_in_reports boolean not null default true,
  sort_order int not null default 0,
  is_active boolean not null default true,
  has_historical_values boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, scope, field_key)
);

create table public.category_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.category_fields(id) on delete cascade,
  value_key text not null check (nullif(trim(value_key), '') is not null),
  label text not null check (nullif(trim(label), '') is not null),
  sort_order int not null default 0,
  is_active boolean not null default true,
  has_historical_values boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (field_id, value_key)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  name text not null check (nullif(trim(name), '') is not null),
  category_id uuid not null references public.categories(id),
  location text,
  status public.entity_status not null default 'active',
  notes text,
  is_default boolean not null default false,
  fuel_rate_override numeric check (fuel_rate_override is null or fuel_rate_override >= 0),
  has_fuel_rate_override boolean not null default false,
  chlorine_consumption_override numeric check (chlorine_consumption_override is null or chlorine_consumption_override >= 0),
  has_chlorine_consumption_override boolean not null default false,
  residual_chlorine_override numeric check (residual_chlorine_override is null or residual_chlorine_override >= 0),
  has_residual_chlorine_override boolean not null default false,
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'active' or is_default = false)
);

create unique index one_default_asset_per_category
  on public.assets(category_id)
  where is_default and status = 'active';

create index assets_category_code on public.assets(category_id, asset_code);

create table public.asset_field_values (
  asset_id uuid not null references public.assets(id) on delete cascade,
  field_id uuid not null references public.category_fields(id),
  value_text text,
  value_number numeric,
  value_date date,
  value_boolean boolean,
  value_option_id uuid references public.category_field_options(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (asset_id, field_id),
  check (num_nonnulls(value_text, value_number, value_date, value_boolean, value_option_id) <= 1)
);

create table public.operators (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(trim(name), '') is not null),
  phone text,
  notes text,
  status public.entity_status not null default 'active',
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fuel_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (nullif(trim(name), '') is not null),
  unit text not null check (nullif(trim(unit), '') is not null),
  status public.entity_status not null default 'active',
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.operation_logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  operation_date date not null check (operation_date <= current_date),
  record_type public.operation_record_type not null default 'daily',
  operator_id uuid references public.operators(id),
  fuel_type_id uuid references public.fuel_types(id),
  previous_reading numeric check (previous_reading is null or previous_reading >= 0),
  current_reading numeric check (current_reading is null or current_reading >= 0),
  usage_value numeric check (usage_value is null or usage_value >= 0),
  effective_fuel_rate numeric check (effective_fuel_rate is null or effective_fuel_rate >= 0),
  fuel_consumed numeric not null default 0 check (fuel_consumed >= 0),
  chlorine_consumed numeric not null default 0 check (chlorine_consumed >= 0),
  residual_chlorine numeric check (residual_chlorine is null or residual_chlorine >= 0),
  notes text check (notes is null or char_length(notes) <= 500),
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, operation_date)
);

create index op_asset_date on public.operation_logs(asset_id, operation_date desc);

create table public.operation_log_values (
  operation_log_id uuid not null references public.operation_logs(id) on delete cascade,
  field_id uuid not null references public.category_fields(id),
  value_text text,
  value_number numeric,
  value_date date,
  value_boolean boolean,
  value_option_id uuid references public.category_field_options(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (operation_log_id, field_id),
  check (num_nonnulls(value_text, value_number, value_date, value_boolean, value_option_id) <= 1)
);

create table public.fuel_transactions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  fuel_type_id uuid not null references public.fuel_types(id),
  transaction_date date not null check (transaction_date <= current_date),
  transaction_type public.transaction_type not null check (transaction_type <> 'receipt'),
  quantity numeric not null check (quantity > 0),
  operator_id uuid references public.operators(id),
  supplier text,
  invoice_number text,
  adjustment_reason text,
  notes text check (notes is null or char_length(notes) <= 500),
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (transaction_type in ('adjustment_plus', 'adjustment_minus') and nullif(trim(adjustment_reason), '') is not null)
    or transaction_type = 'supply'
  )
);

create index fuel_asset_date on public.fuel_transactions(asset_id, transaction_date desc, created_at desc);

create table public.chlorine_transactions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  transaction_date date not null check (transaction_date <= current_date),
  transaction_type public.transaction_type not null check (transaction_type <> 'supply'),
  quantity numeric not null check (quantity > 0),
  supplier text,
  adjustment_reason text,
  notes text check (notes is null or char_length(notes) <= 500),
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (transaction_type in ('adjustment_plus', 'adjustment_minus') and nullif(trim(adjustment_reason), '') is not null)
    or transaction_type = 'receipt'
  )
);

create index chlorine_asset_date on public.chlorine_transactions(asset_id, transaction_date desc, created_at desc);

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  title text not null,
  description text,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index timeline_asset_created on public.timeline_events(asset_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  reason text,
  device_info text,
  created_at timestamptz not null default now()
);

create index audit_created_idx on public.audit_logs(created_at desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- Views for effective defaults and theoretical balances per asset
create or replace view public.asset_effective_defaults with (security_invoker = true) as
select
  a.id,
  a.asset_code,
  a.category_id,
  case when a.has_fuel_rate_override then a.fuel_rate_override else c.default_fuel_rate end as effective_fuel_rate,
  case when a.has_chlorine_consumption_override then a.chlorine_consumption_override else c.default_chlorine_consumption end as effective_chlorine_consumption,
  case when a.has_residual_chlorine_override then a.residual_chlorine_override else c.default_residual_chlorine end as effective_residual_chlorine
from public.assets a
join public.categories c on c.id = a.category_id;

create or replace view public.asset_fuel_balances with (security_invoker = true) as
select
  a.id as asset_id,
  ft.id as fuel_type_id,
  coalesce(
    (
      select sum(
        case t.transaction_type
          when 'supply' then t.quantity
          when 'adjustment_plus' then t.quantity
          when 'adjustment_minus' then -t.quantity
          else 0
        end
      )
      from public.fuel_transactions t
      where t.asset_id = a.id and t.fuel_type_id = ft.id
    ),
    0
  ) - coalesce(
    (
      select sum(o.fuel_consumed)
      from public.operation_logs o
      where o.asset_id = a.id
        and (
          o.fuel_type_id = ft.id
          or (
            o.fuel_type_id is null
            and ft.id = (select id from public.fuel_types order by created_at asc limit 1)
          )
        )
    ),
    0
  ) as balance
from public.assets a
cross join public.fuel_types ft;

create or replace view public.asset_chlorine_balances with (security_invoker = true) as
select
  a.id as asset_id,
  coalesce(
    (
      select sum(
        case t.transaction_type
          when 'receipt' then t.quantity
          when 'adjustment_plus' then t.quantity
          when 'adjustment_minus' then -t.quantity
          else 0
        end
      )
      from public.chlorine_transactions t
      where t.asset_id = a.id
    ),
    0
  ) - coalesce(
    (
      select sum(o.chlorine_consumed)
      from public.operation_logs o
      where o.asset_id = a.id
    ),
    0
  ) as balance
from public.assets a;

-- Domain Integrity Triggers (prevent physical deletion & protect historical invariants)
create or replace function public.trg_protect_categories_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('aoms.in_restore', true) = 'true' then
      return old;
    end if;
    raise exception 'لا يسمح بالحذف المادي للتصنيفات؛ استخدم التعطيل';
  end if;

  new.code_prefix := upper(regexp_replace(trim(coalesce(new.code_prefix, '')), '\s+', '', 'g'));
  if not new.uses_meter then
    new.meter_unit := null;
  end if;

  if tg_op = 'UPDATE' and old.code_prefix <> new.code_prefix then
    if exists (select 1 from public.assets where category_id = old.id) then
      raise exception 'لا يمكن تغيير اختصار التصنيف بعد إنشاء أصول تابعة له';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_protect_categories
before insert or update or delete on public.categories
for each row execute function public.trg_protect_categories_fn();

create or replace function public.trg_protect_category_fields_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used boolean;
begin
  if tg_op = 'DELETE' then
    if current_setting('aoms.in_restore', true) = 'true' then
      return old;
    end if;
    v_used := old.has_historical_values
      or exists (select 1 from public.asset_field_values where field_id = old.id)
      or exists (select 1 from public.operation_log_values where field_id = old.id);
    if v_used then
      raise exception 'لا يسمح بالحذف المادي لحقل ديناميكي مستخدم؛ استخدم التعطيل';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    v_used := old.has_historical_values
      or exists (select 1 from public.asset_field_values where field_id = old.id)
      or exists (select 1 from public.operation_log_values where field_id = old.id);
    if v_used and (old.field_type <> new.field_type or old.field_key <> new.field_key) then
      raise exception 'لا يمكن تغيير نوع الحقل أو مفتاحه بعد استخدامه في سجلات فعلية';
    end if;
    if not old.is_required and new.is_required and new.required_since is null then
      new.required_since := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_protect_category_fields
before update or delete on public.category_fields
for each row execute function public.trg_protect_category_fields_fn();

create or replace function public.trg_protect_field_options_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('aoms.in_restore', true) = 'true' then
      return old;
    end if;
    if old.has_historical_values
       or exists (select 1 from public.asset_field_values where value_option_id = old.id)
       or exists (select 1 from public.operation_log_values where value_option_id = old.id) then
      raise exception 'لا يسمح بحذف خيار قائمة منسدلة مستخدم تاريخيًا؛ استخدم التعطيل';
    end if;
  end if;
  return old;
end;
$$;

create trigger trg_protect_field_options
before delete on public.category_field_options
for each row execute function public.trg_protect_field_options_fn();

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
    return old;
  end if;
  raise exception 'الحذف المادي غير مسموح لهذا الكيان؛ استخدم التعطيل';
end;
$$;

create trigger trg_no_delete_assets
before delete on public.assets
for each row execute function public.trg_prevent_entity_delete_fn();

create trigger trg_no_delete_operators
before delete on public.operators
for each row execute function public.trg_prevent_entity_delete_fn();

create trigger trg_no_delete_fuel_types
before delete on public.fuel_types
for each row execute function public.trg_prevent_entity_delete_fn();

-- Helper function: validate and store typed dynamic field values inside the active transaction
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
begin
  for f in
    select * from public.category_fields
    where category_id = p_category_id and scope = p_scope and is_active = true
    order by sort_order asc
  loop
    raw_val := coalesce(p_values -> (f.id::text), p_values -> f.field_key);
    txt_val := null;
    num_val := null;
    date_val := null;
    bool_val := null;
    opt_id := null;

    if raw_val is null or raw_val = 'null'::jsonb or (jsonb_typeof(raw_val) = 'string' and trim(raw_val #>> '{}') = '') then
      if f.is_required then
        raise exception 'الحقل الديناميكي الإلزامي «%» مطلوب', f.label;
      end if;
      continue;
    end if;

    if f.field_type = 'text' then
      txt_val := raw_val #>> '{}';
    elsif f.field_type = 'number' then
      begin
        num_val := (raw_val #>> '{}')::numeric;
      exception when others then
        raise exception 'قيمة الحقل «%» يجب أن تكون رقمًا صالحًا', f.label;
      end;
    elsif f.field_type = 'date' then
      begin
        date_val := (raw_val #>> '{}')::date;
      exception when others then
        raise exception 'قيمة الحقل «%» يجب أن تكون تاريخًا صالحًا', f.label;
      end;
    elsif f.field_type = 'boolean' then
      if jsonb_typeof(raw_val) = 'boolean' then
        bool_val := (raw_val #>> '{}')::boolean;
      elsif (raw_val #>> '{}') in ('true', 'false') then
        bool_val := (raw_val #>> '{}')::boolean;
      else
        raise exception 'قيمة الحقل «%» يجب أن تكون منطقية (نعم/لا)', f.label;
      end if;
    elsif f.field_type = 'select' then
      select id into opt_id
      from public.category_field_options
      where field_id = f.id
        and (id::text = (raw_val #>> '{}') or value_key = (raw_val #>> '{}'))
        and is_active = true
      limit 1;
      if opt_id is null then
        raise exception 'الخيار المحدد للحقل «%» غير صالح أو غير نشط', f.label;
      end if;
      update public.category_field_options set has_historical_values = true where id = opt_id;
    end if;

    update public.category_fields set has_historical_values = true where id = f.id;

    if p_scope = 'asset' then
      insert into public.asset_field_values (
        asset_id, field_id, value_text, value_number, value_date, value_boolean, value_option_id, created_by, updated_by, updated_at
      )
      values (
        p_target_id, f.id, txt_val, num_val, date_val, bool_val, opt_id, auth.uid(), auth.uid(), now()
      )
      on conflict (asset_id, field_id) do update set
        value_text = excluded.value_text,
        value_number = excluded.value_number,
        value_date = excluded.value_date,
        value_boolean = excluded.value_boolean,
        value_option_id = excluded.value_option_id,
        updated_by = auth.uid(),
        updated_at = now();
    else
      insert into public.operation_log_values (
        operation_log_id, field_id, value_text, value_number, value_date, value_boolean, value_option_id, created_by, updated_by, updated_at
      )
      values (
        p_target_id, f.id, txt_val, num_val, date_val, bool_val, opt_id, auth.uid(), auth.uid(), now()
      )
      on conflict (operation_log_id, field_id) do update set
        value_text = excluded.value_text,
        value_number = excluded.value_number,
        value_date = excluded.value_date,
        value_boolean = excluded.value_boolean,
        value_option_id = excluded.value_option_id,
        updated_by = auth.uid(),
        updated_at = now();
    end if;
  end loop;
end;
$$;

-- Atomic RPC: Create Asset with sequence generation, overrides, default handling, and dynamic values
create or replace function public.create_asset(p_asset jsonb, p_values jsonb default '{}')
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.categories;
  a public.assets;
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

  seq := c.next_asset_sequence;
  update public.categories set next_asset_sequence = seq + 1, updated_at = now(), updated_by = auth.uid() where id = c.id;

  want_default := coalesce((p_asset ->> 'is_default')::boolean, false) and coalesce(p_asset ->> 'status', 'active') = 'active';
  if want_default then
    update public.assets
    set is_default = false, updated_at = now(), updated_by = auth.uid(), version = version + 1
    where category_id = c.id and is_default = true;
  end if;

  insert into public.assets (
    asset_code,
    name,
    category_id,
    location,
    notes,
    status,
    is_default,
    has_fuel_rate_override,
    fuel_rate_override,
    has_chlorine_consumption_override,
    chlorine_consumption_override,
    has_residual_chlorine_override,
    residual_chlorine_override,
    created_by,
    updated_by
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
    nullif(p_asset ->> 'fuel_rate_override', '')::numeric,
    coalesce((p_asset ->> 'has_chlorine_consumption_override')::boolean, false),
    nullif(p_asset ->> 'chlorine_consumption_override', '')::numeric,
    coalesce((p_asset ->> 'has_residual_chlorine_override')::boolean, false),
    nullif(p_asset ->> 'residual_chlorine_override', '')::numeric,
    auth.uid(),
    auth.uid()
  )
  returning * into a;

  perform public.validate_and_save_dynamic_values(c.id, 'asset', a.id, coalesce(p_values, '{}'::jsonb), a.created_at);

  insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, description, created_by)
  values (a.id, 'asset_created', 'asset', a.id, 'إنشاء الأصل ' || a.asset_code, a.name, auth.uid());

  insert into public.audit_logs (user_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'create', 'asset', a.id, to_jsonb(a));

  return a;
end;
$$;

-- Atomic RPC: Update Asset with version concurrency check and automatic default transfer on deactivation
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
  c public.categories;
  new_status public.entity_status;
  new_default boolean;
  replacement_id uuid;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select * into old_a from public.assets where id = p_id for update;
  if old_a.id is null then
    raise exception 'الأصل غير موجود';
  end if;
  if p_version is not null and old_a.version <> p_version then
    raise exception 'تعارض إصدار: تم تعديل الأصل من جهاز آخر (الإصدار الحالي: %)', old_a.version;
  end if;

  select * into c from public.categories where id = coalesce((p_asset ->> 'category_id')::uuid, old_a.category_id);
  if c.id <> old_a.category_id and c.status <> 'active' then
    raise exception 'لا يمكن نقل الأصل إلى تصنيف معطل';
  end if;

  new_status := coalesce((p_asset ->> 'status')::public.entity_status, old_a.status);
  new_default := coalesce((p_asset ->> 'is_default')::boolean, old_a.is_default);

  if new_status = 'inactive' then
    new_default := false;
  elsif old_a.status = 'inactive' and new_status = 'active' and (p_asset ->> 'is_default') is null then
    new_default := false;
  end if;

  if new_default and not old_a.is_default then
    update public.assets
    set is_default = false, updated_at = now(), updated_by = auth.uid(), version = version + 1
    where category_id = c.id and is_default = true and id <> old_a.id;
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

  -- عند تعطيل الأصل الافتراضي يُنقل الوضع تلقائيًا إلى أول أصل نشط حسب الكود (7.3.4)
  if old_a.is_default and new_a.status = 'inactive' then
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

  insert into public.timeline_events (
    asset_id, event_type, entity_type, entity_id, title, description, created_by
  )
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

-- Atomic RPC: Set Default Asset
create or replace function public.set_default_asset(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assets;
  prev_default public.assets;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select * into a from public.assets where id = p_asset_id for update;
  if a.id is null or a.status <> 'active' then
    raise exception 'لا يمكن تعيين أصل غير نشط كأصل افتراضي';
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

-- Atomic RPC: Save (Create or Edit Latest) Operation Log
create or replace function public.save_operation_log(p_log jsonb, p_values jsonb default '{}')
returns public.operation_logs
language plpgsql
security definer
set search_path = public
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

  rate := case when a.has_fuel_rate_override then a.fuel_rate_override else c.default_fuel_rate end;
  fuel_cons := case
    when c.supports_fuel and c.uses_meter and usage is not null then round(usage * coalesce(rate, 0), 2)
    else 0
  end;

  v_fuel_type_id := coalesce(
    nullif(p_log ->> 'fuel_type_id', '')::uuid,
    (select fuel_type_id from public.fuel_transactions where asset_id = a.id order by transaction_date desc limit 1),
    (select id from public.fuel_types where status = 'active' order by created_at asc limit 1)
  );

  if c.supports_fuel and fuel_cons > 0 and v_fuel_type_id is not null then
    select balance into v_fuel_bal
    from public.asset_fuel_balances
    where asset_id = a.id and fuel_type_id = v_fuel_type_id;
    if coalesce(v_fuel_bal, 0) + coalesce(old_log.fuel_consumed, 0) - fuel_cons < 0 then
      raise exception 'الرصيد النظري للوقود لا يكفي لتغطية الاستهلاك المحسوب (%)', fuel_cons;
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
      asset_id,
      operation_date,
      record_type,
      operator_id,
      fuel_type_id,
      previous_reading,
      current_reading,
      usage_value,
      effective_fuel_rate,
      fuel_consumed,
      chlorine_consumed,
      residual_chlorine,
      notes,
      created_by,
      updated_by
    )
    values (
      a.id,
      op_date,
      rec_type,
      nullif(p_log ->> 'operator_id', '')::uuid,
      v_fuel_type_id,
      prev_read,
      curr_read,
      usage,
      case when c.supports_fuel then rate else null end,
      fuel_cons,
      chl_cons,
      res_chl,
      p_log ->> 'notes',
      auth.uid(),
      auth.uid()
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

-- Atomic RPC: Delete Latest Operation Log
create or replace function public.delete_operation_log(p_id uuid, p_version bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.operation_logs;
begin
  if not public.can_operate() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select * into r from public.operation_logs where id = p_id for update;
  if r.id is null then
    raise exception 'السجل غير موجود';
  end if;
  if p_version is not null and r.version <> p_version then
    raise exception 'تعارض إصدار: تم تعديل السجل من جهاز آخر (الإصدار الحالي: %)', r.version;
  end if;
  if exists (
    select 1 from public.operation_logs
    where asset_id = r.asset_id and (operation_date > r.operation_date or (operation_date = r.operation_date and created_at > r.created_at))
  ) then
    raise exception 'لا يمكن حذف سوى آخر سجل تشغيل للأصل';
  end if;

  delete from public.operation_logs where id = p_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json)
  values (auth.uid(), 'delete', 'operation_log', p_id, to_jsonb(r));

  insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
  values (r.asset_id, 'operation_deleted', 'operation_log', p_id, 'حذف سجل تشغيل (' || r.operation_date || ')', auth.uid());
end;
$$;

-- Full 6-Entity Global Search Function (Categories, Assets + Dynamic Values, Operators, Operation Logs + Dynamic Values, Fuel, Chlorine)
create or replace function public.global_search(p_query text)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  asset_id uuid,
  tab_key text,
  record_id uuid
)
language sql
stable
security invoker
as $$
  select 'category'::text, c.id, c.code_prefix || ' | ' || c.name, coalesce(c.description, ''), null::uuid, 'categories'::text, c.id
  from public.categories c
  where public.is_active_user()
    and concat_ws(' ', c.code_prefix, c.name, c.description) ilike '%' || trim(p_query) || '%'
  union all
  select 'asset'::text, a.id, a.asset_code || ' | ' || a.name, coalesce(a.location, ''), a.id, 'assets'::text, a.id
  from public.assets a
  where public.is_active_user()
    and (
      concat_ws(' ', a.asset_code, a.name, a.location, a.notes) ilike '%' || trim(p_query) || '%'
      or exists (
        select 1 from public.asset_field_values afv
        where afv.asset_id = a.id and coalesce(afv.value_text, afv.value_number::text, '') ilike '%' || trim(p_query) || '%'
      )
    )
  union all
  select 'operator'::text, o.id, o.name, coalesce(o.phone, ''), null::uuid, 'operators'::text, o.id
  from public.operators o
  where public.is_active_user()
    and concat_ws(' ', o.name, o.phone, o.notes) ilike '%' || trim(p_query) || '%'
  union all
  select 'operation_log'::text, l.id, a.asset_code || ' — تشغيل ' || l.operation_date::text, coalesce(l.notes, ''), l.asset_id, 'operation_logs'::text, l.id
  from public.operation_logs l
  join public.assets a on a.id = l.asset_id
  where public.is_active_user()
    and (
      concat_ws(' ', a.asset_code, a.name, l.operation_date::text, l.notes) ilike '%' || trim(p_query) || '%'
      or exists (
        select 1 from public.operation_log_values olv
        where olv.operation_log_id = l.id and coalesce(olv.value_text, olv.value_number::text, '') ilike '%' || trim(p_query) || '%'
      )
    )
  union all
  select 'fuel_transaction'::text, f.id, a.asset_code || ' — وقود ' || f.transaction_date::text, coalesce(f.supplier, f.notes, ''), f.asset_id, 'fuel_transactions'::text, f.id
  from public.fuel_transactions f
  join public.assets a on a.id = f.asset_id
  where public.is_active_user()
    and concat_ws(' ', a.asset_code, a.name, f.transaction_date::text, f.supplier, f.invoice_number, f.adjustment_reason, f.notes) ilike '%' || trim(p_query) || '%'
  union all
  select 'chlorine_transaction'::text, ch.id, a.asset_code || ' — كلور ' || ch.transaction_date::text, coalesce(ch.supplier, ch.notes, ''), ch.asset_id, 'chlorine_transactions'::text, ch.id
  from public.chlorine_transactions ch
  join public.assets a on a.id = ch.asset_id
  where public.is_active_user()
    and concat_ws(' ', a.asset_code, a.name, ch.transaction_date::text, ch.supplier, ch.adjustment_reason, ch.notes) ilike '%' || trim(p_query) || '%'
$$;

-- RLS Policies: Enable RLS on all tables, restrict audit_logs strictly to Admin, and enforce role boundaries
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'categories',
    'category_fields',
    'category_field_options',
    'assets',
    'asset_field_values',
    'operators',
    'operation_logs',
    'operation_log_values',
    'fuel_types',
    'fuel_transactions',
    'chlorine_transactions',
    'timeline_events',
    'audit_logs',
    'app_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    if t = 'audit_logs' then
      execute 'create policy read_admin_only on public.audit_logs for select to authenticated using (public.is_admin())';
    else
      execute format('create policy read_active on public.%I for select to authenticated using (public.is_active_user())', t);
    end if;
  end loop;
end
$$;

create policy admin_profiles on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_categories on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_fields on public.category_fields for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_options on public.category_field_options for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_assets on public.assets for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_asset_values on public.asset_field_values for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_operators on public.operators for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_fuel_types on public.fuel_types for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_settings on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.categories, public.category_fields, public.category_field_options, public.assets, public.asset_field_values, public.operators, public.fuel_types, public.app_settings, public.profiles to authenticated;
grant execute on all functions in schema public to authenticated;

insert into public.app_settings (key, value)
values
  ('schema_version', '"2.0.0"'::jsonb),
  ('chlorine_unit', '"كجم"'::jsonb),
  ('organization_name', '"نظام إدارة وتشغيل الأصول والمعدات"'::jsonb)
on conflict (key) do nothing;

commit;
