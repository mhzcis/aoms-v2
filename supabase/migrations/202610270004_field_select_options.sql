-- =====================================================================
-- AOMS V2 — Migration 004: FIELD-003 enforced in the database.
-- An ACTIVE select field must always have at least one ACTIVE option.
-- Checked by DEFERRED constraint triggers (at commit), so a field and its
-- options can be written together in one transaction (save_category_field
-- RPC, restore_aoms_backup). A lone select field without options, or
-- deactivating/removing the last active option, is rejected.
-- =====================================================================
begin;

create or replace function public.aoms_assert_select_has_option(p_field_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.category_fields f
    where f.id = p_field_id and f.field_type = 'select' and f.is_active
      and not exists (select 1 from public.category_field_options o
                      where o.field_id = f.id and o.is_active and nullif(trim(o.label), '') is not null)
  ) then
    raise exception 'FIELD-003: حقل القائمة المنسدلة النشط يجب أن يحتوي خيارًا نشطًا واحدًا على الأقل'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.trg_select_field_options_fn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'category_fields' then
    perform public.aoms_assert_select_has_option(new.id);
  else
    if tg_op in ('UPDATE', 'DELETE') then perform public.aoms_assert_select_has_option(old.field_id); end if;
    if tg_op = 'UPDATE' and new.field_id is distinct from old.field_id then perform public.aoms_assert_select_has_option(new.field_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_select_field_has_option on public.category_fields;
create constraint trigger trg_select_field_has_option
after insert or update of field_type, is_active on public.category_fields
deferrable initially deferred
for each row execute function public.trg_select_field_options_fn();

drop trigger if exists trg_select_option_keeps_field on public.category_field_options;
create constraint trigger trg_select_option_keeps_field
after update or delete on public.category_field_options
deferrable initially deferred
for each row execute function public.trg_select_field_options_fn();

-- Atomic save of a dynamic field together with its options (used by the app).
-- p_options is the full desired option list; unlisted options are disabled.
-- SECURITY INVOKER: the existing admin-only RLS policies and triggers apply.
create or replace function public.save_category_field(p_field jsonb, p_options jsonb default '[]')
returns public.category_fields
language plpgsql security invoker set search_path = public as $$
declare
  f public.category_fields;
  o jsonb;
  i int := 0;
  v_key text;
  v_opt uuid;
  v_keep uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'إدارة الحقول للمدير فقط' using errcode = '42501';
  end if;
  if nullif(p_field ->> 'id', '') is not null then
    update public.category_fields set
      label = p_field ->> 'label',
      description = coalesce(p_field ->> 'description', ''),
      field_type = (p_field ->> 'field_type')::public.field_type,
      field_key = p_field ->> 'field_key',
      unit = coalesce(p_field ->> 'unit', ''),
      is_required = coalesce((p_field ->> 'is_required')::boolean, false),
      show_in_reports = coalesce((p_field ->> 'show_in_reports')::boolean, true),
      sort_order = coalesce((p_field ->> 'sort_order')::int, 0),
      is_active = coalesce((p_field ->> 'is_active')::boolean, true),
      updated_at = now()
    where id = (p_field ->> 'id')::uuid
    returning * into f;
    if f.id is null then
      raise exception 'الحقل غير موجود' using errcode = 'P0002';
    end if;
  else
    insert into public.category_fields (category_id, scope, field_key, label, description, field_type, unit,
                                        is_required, show_in_reports, sort_order, is_active)
    values ((p_field ->> 'category_id')::uuid, (p_field ->> 'scope')::public.field_scope, p_field ->> 'field_key',
            p_field ->> 'label', coalesce(p_field ->> 'description', ''), (p_field ->> 'field_type')::public.field_type,
            coalesce(p_field ->> 'unit', ''), coalesce((p_field ->> 'is_required')::boolean, false),
            coalesce((p_field ->> 'show_in_reports')::boolean, true), coalesce((p_field ->> 'sort_order')::int, 0),
            coalesce((p_field ->> 'is_active')::boolean, true))
    returning * into f;
  end if;

  if f.field_type = 'select' and p_options is not null then
    for o in select * from jsonb_array_elements(p_options) loop
      i := i + 1;
      continue when nullif(trim(o ->> 'label'), '') is null;
      -- match an existing option by id, else by label (editing re-sends the whole list)
      select x.id into v_opt from public.category_field_options x
       where x.field_id = f.id
         and (x.id = nullif(o ->> 'id', '')::uuid or (nullif(o ->> 'id', '') is null and trim(x.label) = trim(o ->> 'label')))
       order by x.is_active desc limit 1;
      if v_opt is not null then
        update public.category_field_options set
          label = trim(o ->> 'label'),
          sort_order = coalesce((o ->> 'sort_order')::int, i - 1),
          is_active = coalesce((o ->> 'is_active')::boolean, true)
        where id = v_opt;
      else
        v_key := coalesce(nullif(regexp_replace(lower(trim(coalesce(o ->> 'value_key', o ->> 'label'))), '\s+', '_', 'g'), ''), 'opt_' || i);
        while exists (select 1 from public.category_field_options x where x.field_id = f.id and x.value_key = v_key) loop
          v_key := v_key || '_' || i;
        end loop;
        insert into public.category_field_options (field_id, value_key, label, sort_order, is_active)
        values (f.id, v_key, trim(o ->> 'label'), coalesce((o ->> 'sort_order')::int, i - 1), coalesce((o ->> 'is_active')::boolean, true))
        returning id into v_opt;
      end if;
      v_keep := v_keep || v_opt;
      v_opt := null;
    end loop;
    -- options no longer listed are DISABLED (never deleted: history keeps its labels)
    update public.category_field_options set is_active = false
     where field_id = f.id and is_active and not (id = any (v_keep));
  end if;
  -- surface FIELD-003 inside the RPC instead of at commit
  set constraints trg_select_field_has_option, trg_select_option_keeps_field immediate;
  return f;
end;
$$;

revoke execute on function public.aoms_assert_select_has_option(uuid), public.trg_select_field_options_fn() from public, anon, authenticated;
revoke execute on function public.save_category_field(jsonb, jsonb) from public, anon;
grant execute on function public.save_category_field(jsonb, jsonb) to authenticated;

insert into public.app_settings (key, value) values ('schema_migration', '"202610270004"'::jsonb)
on conflict (key) do update set value = excluded.value;

commit;
