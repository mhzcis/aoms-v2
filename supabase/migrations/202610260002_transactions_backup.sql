begin;

-- Atomic RPC: Save (Create or Edit Latest) Fuel Transaction with negative balance protection
create or replace function public.save_fuel_transaction(p_transaction jsonb)
returns public.fuel_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assets;
  c public.categories;
  ft public.fuel_types;
  op public.operators;
  editing boolean;
  target_id uuid;
  old_tx public.fuel_transactions;
  latest_tx public.fuel_transactions;
  r public.fuel_transactions;
  tx_type public.transaction_type;
  qty numeric;
  bal numeric;
  old_delta numeric := 0;
  new_delta numeric;
begin
  if not public.can_operate() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  target_id := nullif(p_transaction ->> 'id', '')::uuid;
  editing := target_id is not null;

  if editing then
    select * into old_tx from public.fuel_transactions where id = target_id for update;
    if old_tx.id is null then
      raise exception 'حركة الوقود غير موجودة';
    end if;
    if (p_transaction ->> 'version') is not null and old_tx.version <> (p_transaction ->> 'version')::bigint then
      raise exception 'تعارض إصدار: تم تعديل الحركة من جهاز آخر (الإصدار الحالي: %)', old_tx.version;
    end if;
    select * into a from public.assets where id = old_tx.asset_id for update;
    select * into latest_tx
    from public.fuel_transactions
    where asset_id = a.id
    order by transaction_date desc, created_at desc
    limit 1;
    if latest_tx.id <> old_tx.id then
      raise exception 'لا يمكن تعديل سوى آخر حركة وقود للأصل';
    end if;
    old_delta := case old_tx.transaction_type
      when 'supply' then old_tx.quantity
      when 'adjustment_plus' then old_tx.quantity
      else -old_tx.quantity
    end;
  else
    select * into a from public.assets where id = (p_transaction ->> 'asset_id')::uuid for update;
    if a.id is null or a.status <> 'active' then
      raise exception 'لا يمكن إضافة حركة وقود لأصل غير نشط';
    end if;
  end if;

  select * into c from public.categories where id = a.category_id;
  if not c.supports_fuel then
    raise exception 'تصنيف هذا الأصل لا يدعم الوقود';
  end if;

  select * into ft from public.fuel_types where id = coalesce((p_transaction ->> 'fuel_type_id')::uuid, old_tx.fuel_type_id);
  if ft.id is null or (ft.status <> 'active' and (not editing or old_tx.fuel_type_id <> ft.id)) then
    raise exception 'نوع الوقود غير صالح أو غير نشط';
  end if;

  if nullif(p_transaction ->> 'operator_id', '') is not null then
    select * into op from public.operators where id = (p_transaction ->> 'operator_id')::uuid;
    if op.id is null or (op.status <> 'active' and (not editing or old_tx.operator_id is distinct from op.id)) then
      raise exception 'المشغل المحدد غير نشط';
    end if;
  end if;

  tx_type := (p_transaction ->> 'transaction_type')::public.transaction_type;
  qty := (p_transaction ->> 'quantity')::numeric;
  if qty is null or qty <= 0 then
    raise exception 'الكمية يجب أن تكون رقمًا موجبًا أكبر من صفر';
  end if;

  if tx_type in ('adjustment_plus', 'adjustment_minus') and nullif(trim(coalesce(p_transaction ->> 'adjustment_reason', '')), '') is null then
    raise exception 'سبب التسوية إلزامي لحركات التسوية';
  end if;

  new_delta := case tx_type
    when 'supply' then qty
    when 'adjustment_plus' then qty
    else -qty
  end;

  select balance into bal
  from public.asset_fuel_balances
  where asset_id = a.id and fuel_type_id = ft.id;

  if coalesce(bal, 0) - old_delta + new_delta < 0 then
    raise exception 'لا يسمح بإنشاء رصيد وقود سالب (الرصيد المتاح: %)', coalesce(bal, 0);
  end if;

  if editing then
    update public.fuel_transactions
    set
      fuel_type_id = ft.id,
      transaction_date = (p_transaction ->> 'transaction_date')::date,
      transaction_type = tx_type,
      quantity = qty,
      operator_id = nullif(p_transaction ->> 'operator_id', '')::uuid,
      supplier = p_transaction ->> 'supplier',
      invoice_number = p_transaction ->> 'invoice_number',
      adjustment_reason = p_transaction ->> 'adjustment_reason',
      notes = p_transaction ->> 'notes',
      version = old_tx.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where id = old_tx.id
    returning * into r;

    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (a.id, 'fuel_updated', 'fuel_transaction', r.id, 'تعديل حركة وقود', auth.uid());

    insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json, after_json, reason)
    values (auth.uid(), 'update', 'fuel_transaction', r.id, to_jsonb(old_tx), to_jsonb(r), r.adjustment_reason);
  else
    insert into public.fuel_transactions (
      asset_id,
      fuel_type_id,
      transaction_date,
      transaction_type,
      quantity,
      operator_id,
      supplier,
      invoice_number,
      adjustment_reason,
      notes,
      created_by,
      updated_by
    )
    values (
      a.id,
      ft.id,
      (p_transaction ->> 'transaction_date')::date,
      tx_type,
      qty,
      nullif(p_transaction ->> 'operator_id', '')::uuid,
      p_transaction ->> 'supplier',
      p_transaction ->> 'invoice_number',
      p_transaction ->> 'adjustment_reason',
      p_transaction ->> 'notes',
      auth.uid(),
      auth.uid()
    )
    returning * into r;

    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (a.id, 'fuel_created', 'fuel_transaction', r.id, 'إضافة حركة وقود', auth.uid());

    insert into public.audit_logs (user_id, action, entity_type, entity_id, after_json, reason)
    values (auth.uid(), 'create', 'fuel_transaction', r.id, to_jsonb(r), r.adjustment_reason);
  end if;

  return r;
end;
$$;

-- Atomic RPC: Delete Latest Fuel Transaction
create or replace function public.delete_fuel_transaction(p_id uuid, p_version bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.fuel_transactions;
  latest_tx public.fuel_transactions;
  bal numeric;
  tx_delta numeric;
begin
  if not public.can_operate() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select * into r from public.fuel_transactions where id = p_id for update;
  if r.id is null then
    raise exception 'حركة الوقود غير موجودة';
  end if;
  if p_version is not null and r.version <> p_version then
    raise exception 'تعارض إصدار: تم تعديل الحركة من جهاز آخر';
  end if;

  select * into latest_tx
  from public.fuel_transactions
  where asset_id = r.asset_id
  order by transaction_date desc, created_at desc
  limit 1;

  if latest_tx.id <> r.id then
    raise exception 'لا يمكن حذف سوى آخر حركة وقود للأصل';
  end if;

  tx_delta := case r.transaction_type
    when 'supply' then r.quantity
    when 'adjustment_plus' then r.quantity
    else -r.quantity
  end;

  select balance into bal
  from public.asset_fuel_balances
  where asset_id = r.asset_id and fuel_type_id = r.fuel_type_id;

  if coalesce(bal, 0) - tx_delta < 0 then
    raise exception 'لا يمكن حذف حركة التزويد لأن حذفها يؤدي إلى رصيد وقود سالب';
  end if;

  delete from public.fuel_transactions where id = r.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json)
  values (auth.uid(), 'delete', 'fuel_transaction', r.id, to_jsonb(r));

  insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
  values (r.asset_id, 'fuel_deleted', 'fuel_transaction', r.id, 'حذف حركة وقود', auth.uid());
end;
$$;

-- Atomic RPC: Save (Create or Edit Latest) Chlorine Transaction
create or replace function public.save_chlorine_transaction(p_transaction jsonb)
returns public.chlorine_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assets;
  c public.categories;
  editing boolean;
  target_id uuid;
  old_tx public.chlorine_transactions;
  latest_tx public.chlorine_transactions;
  r public.chlorine_transactions;
  tx_type public.transaction_type;
  qty numeric;
  bal numeric;
  old_delta numeric := 0;
  new_delta numeric;
begin
  if not public.can_operate() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  target_id := nullif(p_transaction ->> 'id', '')::uuid;
  editing := target_id is not null;

  if editing then
    select * into old_tx from public.chlorine_transactions where id = target_id for update;
    if old_tx.id is null then
      raise exception 'حركة الكلور غير موجودة';
    end if;
    if (p_transaction ->> 'version') is not null and old_tx.version <> (p_transaction ->> 'version')::bigint then
      raise exception 'تعارض إصدار: تم تعديل الحركة من جهاز آخر';
    end if;
    select * into a from public.assets where id = old_tx.asset_id for update;
    select * into latest_tx
    from public.chlorine_transactions
    where asset_id = a.id
    order by transaction_date desc, created_at desc
    limit 1;
    if latest_tx.id <> old_tx.id then
      raise exception 'لا يمكن تعديل سوى آخر حركة كلور للأصل';
    end if;
    old_delta := case old_tx.transaction_type
      when 'receipt' then old_tx.quantity
      when 'adjustment_plus' then old_tx.quantity
      else -old_tx.quantity
    end;
  else
    select * into a from public.assets where id = (p_transaction ->> 'asset_id')::uuid for update;
    if a.id is null or a.status <> 'active' then
      raise exception 'لا يمكن إضافة حركة كلور لأصل غير نشط';
    end if;
  end if;

  select * into c from public.categories where id = a.category_id;
  if not c.supports_chlorine then
    raise exception 'تصنيف هذا الأصل لا يدعم الكلور';
  end if;

  tx_type := (p_transaction ->> 'transaction_type')::public.transaction_type;
  qty := (p_transaction ->> 'quantity')::numeric;
  if qty is null or qty <= 0 then
    raise exception 'الكمية يجب أن تكون رقمًا موجبًا أكبر من صفر';
  end if;

  if tx_type in ('adjustment_plus', 'adjustment_minus') and nullif(trim(coalesce(p_transaction ->> 'adjustment_reason', '')), '') is null then
    raise exception 'سبب التسوية إلزامي لحركات التسوية';
  end if;

  new_delta := case tx_type
    when 'receipt' then qty
    when 'adjustment_plus' then qty
    else -qty
  end;

  select balance into bal from public.asset_chlorine_balances where asset_id = a.id;
  if coalesce(bal, 0) - old_delta + new_delta < 0 then
    raise exception 'لا يسمح بإنشاء رصيد كلور سالب (الرصيد المتاح: %)', coalesce(bal, 0);
  end if;

  if editing then
    update public.chlorine_transactions
    set
      transaction_date = (p_transaction ->> 'transaction_date')::date,
      transaction_type = tx_type,
      quantity = qty,
      supplier = p_transaction ->> 'supplier',
      adjustment_reason = p_transaction ->> 'adjustment_reason',
      notes = p_transaction ->> 'notes',
      version = old_tx.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where id = old_tx.id
    returning * into r;

    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (a.id, 'chlorine_updated', 'chlorine_transaction', r.id, 'تعديل حركة كلور', auth.uid());

    insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json, after_json, reason)
    values (auth.uid(), 'update', 'chlorine_transaction', r.id, to_jsonb(old_tx), to_jsonb(r), r.adjustment_reason);
  else
    insert into public.chlorine_transactions (
      asset_id,
      transaction_date,
      transaction_type,
      quantity,
      supplier,
      adjustment_reason,
      notes,
      created_by,
      updated_by
    )
    values (
      a.id,
      (p_transaction ->> 'transaction_date')::date,
      tx_type,
      qty,
      p_transaction ->> 'supplier',
      p_transaction ->> 'adjustment_reason',
      p_transaction ->> 'notes',
      auth.uid(),
      auth.uid()
    )
    returning * into r;

    insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
    values (a.id, 'chlorine_created', 'chlorine_transaction', r.id, 'إضافة حركة كلور', auth.uid());

    insert into public.audit_logs (user_id, action, entity_type, entity_id, after_json, reason)
    values (auth.uid(), 'create', 'chlorine_transaction', r.id, to_jsonb(r), r.adjustment_reason);
  end if;

  return r;
end;
$$;

-- Atomic RPC: Delete Latest Chlorine Transaction
create or replace function public.delete_chlorine_transaction(p_id uuid, p_version bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.chlorine_transactions;
  latest_tx public.chlorine_transactions;
  bal numeric;
  tx_delta numeric;
begin
  if not public.can_operate() then
    raise exception 'غير مصرح بهذه العملية';
  end if;

  select * into r from public.chlorine_transactions where id = p_id for update;
  if r.id is null then
    raise exception 'حركة الكلور غير موجودة';
  end if;
  if p_version is not null and r.version <> p_version then
    raise exception 'تعارض إصدار: تم تعديل الحركة من جهاز آخر';
  end if;

  select * into latest_tx
  from public.chlorine_transactions
  where asset_id = r.asset_id
  order by transaction_date desc, created_at desc
  limit 1;

  if latest_tx.id <> r.id then
    raise exception 'لا يمكن حذف سوى آخر حركة كلور للأصل';
  end if;

  tx_delta := case r.transaction_type
    when 'receipt' then r.quantity
    when 'adjustment_plus' then r.quantity
    else -r.quantity
  end;

  select balance into bal from public.asset_chlorine_balances where asset_id = r.asset_id;
  if coalesce(bal, 0) - tx_delta < 0 then
    raise exception 'لا يمكن حذف حركة الاستلام لأن حذفها يؤدي إلى رصيد كلور سالب';
  end if;

  delete from public.chlorine_transactions where id = r.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_json)
  values (auth.uid(), 'delete', 'chlorine_transaction', r.id, to_jsonb(r));

  insert into public.timeline_events (asset_id, event_type, entity_type, entity_id, title, created_by)
  values (r.asset_id, 'chlorine_deleted', 'chlorine_transaction', r.id, 'حذف حركة كلور', auth.uid());
end;
$$;

-- Full Export Backup RPC (Admin Only, No Passwords/Tokens)
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
    'app_settings', coalesce((select jsonb_agg(x) from public.app_settings x), '[]'::jsonb),
    'profiles', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', id, 'email', email, 'full_name', full_name, 'role', role, 'status', status)
        )
        from public.profiles
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- Full Atomic Restore Backup RPC (Admin Only, Transactional All-or-Nothing with Referential & Domain Validation)
create or replace function public.restore_aoms_backup(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
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

  if jsonb_typeof(p_backup -> 'categories') <> 'array'
     or jsonb_typeof(p_backup -> 'assets') <> 'array'
     or jsonb_typeof(p_backup -> 'operation_logs') <> 'array' then
    raise exception 'ملف النسخة الاحتياطية يفتقر إلى الجداول الأساسية المطلوبة';
  end if;

  -- تفعيل علم الاستعادة الذرية داخل المعاملة الحالية فقط للسماح بإعادة بناء الجداول بأمان
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

  insert into public.categories
  select * from jsonb_populate_recordset(null::public.categories, coalesce(p_backup -> 'categories', '[]'::jsonb));

  insert into public.category_fields
  select * from jsonb_populate_recordset(null::public.category_fields, coalesce(p_backup -> 'category_fields', '[]'::jsonb));

  insert into public.category_field_options
  select * from jsonb_populate_recordset(null::public.category_field_options, coalesce(p_backup -> 'category_field_options', '[]'::jsonb));

  insert into public.operators
  select * from jsonb_populate_recordset(null::public.operators, coalesce(p_backup -> 'operators', '[]'::jsonb));

  insert into public.fuel_types
  select * from jsonb_populate_recordset(null::public.fuel_types, coalesce(p_backup -> 'fuel_types', '[]'::jsonb));

  insert into public.assets
  select * from jsonb_populate_recordset(null::public.assets, coalesce(p_backup -> 'assets', '[]'::jsonb));

  insert into public.asset_field_values
  select * from jsonb_populate_recordset(null::public.asset_field_values, coalesce(p_backup -> 'asset_field_values', '[]'::jsonb));

  insert into public.operation_logs
  select * from jsonb_populate_recordset(null::public.operation_logs, coalesce(p_backup -> 'operation_logs', '[]'::jsonb));

  insert into public.operation_log_values
  select * from jsonb_populate_recordset(null::public.operation_log_values, coalesce(p_backup -> 'operation_log_values', '[]'::jsonb));

  insert into public.fuel_transactions
  select * from jsonb_populate_recordset(null::public.fuel_transactions, coalesce(p_backup -> 'fuel_transactions', '[]'::jsonb));

  insert into public.chlorine_transactions
  select * from jsonb_populate_recordset(null::public.chlorine_transactions, coalesce(p_backup -> 'chlorine_transactions', '[]'::jsonb));

  v_counts := jsonb_build_object(
    'categories', jsonb_array_length(coalesce(p_backup -> 'categories', '[]'::jsonb)),
    'assets', jsonb_array_length(coalesce(p_backup -> 'assets', '[]'::jsonb)),
    'operators', jsonb_array_length(coalesce(p_backup -> 'operators', '[]'::jsonb)),
    'operation_logs', jsonb_array_length(coalesce(p_backup -> 'operation_logs', '[]'::jsonb)),
    'fuel_transactions', jsonb_array_length(coalesce(p_backup -> 'fuel_transactions', '[]'::jsonb)),
    'chlorine_transactions', jsonb_array_length(coalesce(p_backup -> 'chlorine_transactions', '[]'::jsonb))
  );

  insert into public.audit_logs (user_id, action, entity_type, after_json)
  values (auth.uid(), 'restore_backup', 'system', v_counts);

  insert into public.timeline_events (event_type, entity_type, title, metadata, created_by)
  values ('backup_restored', 'system', 'استعادة شاملة للنسخة الاحتياطية', v_counts, auth.uid());

  return v_counts;
end;
$$;

grant execute on function
  public.update_asset(uuid, bigint, jsonb, jsonb),
  public.save_fuel_transaction(jsonb),
  public.delete_fuel_transaction(uuid, bigint),
  public.save_chlorine_transaction(jsonb),
  public.delete_chlorine_transaction(uuid, bigint),
  public.export_aoms_backup(),
  public.restore_aoms_backup(jsonb)
to authenticated;

commit;
