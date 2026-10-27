// AOMS V2 — §22 acceptance criteria on the real PostgreSQL (round 2).
// Usage: PGURL=postgres://postgres@127.0.0.1:54329/<db> node supabase/tests/run-db-acceptance.mjs
import pg from 'pg';

const PGURL = process.env.PGURL || 'postgres://postgres@127.0.0.1:54329/aoms_fixed';
const results = [];
const log = (...a) => console.log(...a);

const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  operator: '00000000-0000-4000-8000-000000000002',
  viewer: '00000000-0000-4000-8000-000000000003',
  inactive: '00000000-0000-4000-8000-000000000004',
};

async function connect(user) {
  const c = new pg.Client({ connectionString: PGURL });
  await c.connect();
  await c.query("set application_name = 'aoms-db-tests'");
  if (user === 'anon') {
    await c.query('set role anon');
  } else if (user) {
    await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U[user], role: 'authenticated' })]);
    await c.query('set role authenticated');
  }
  return c;
}

async function check(id, desc, fn) {
  try {
    const detail = await fn();
    results.push({ id, desc, ok: true, detail });
    log(`PASS ${id} — ${desc}${detail ? ' :: ' + detail : ''}`);
  } catch (e) {
    results.push({ id, desc, ok: false, detail: e.message });
    log(`FAIL ${id} — ${desc} :: ${e.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
async function rejects(promise, re) {
  try { await promise; } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`rejected with unexpected error: ${e.message}`);
    return `rejected: ${e.message.slice(0, 110)}`;
  }
  throw new Error('expected rejection but the statement SUCCEEDED');
}
const one = async (c, sql, p = []) => (await c.query(sql, p)).rows[0];
const VOID_RPCS = new Set(['set_default_asset', 'delete_operation_log', 'delete_fuel_transaction', 'delete_chlorine_transaction']);
// returns { r: <json result> } — composite results come back as objects
const rpc = async (c, fn, args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  if (VOID_RPCS.has(fn)) return one(c, `select public.${fn}(${ph})::text as r`, args);
  const row = await one(c, `select to_jsonb(x) as r from public.${fn}(${ph}) x`, args);
  const r = row.r;
  return { r: r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).length === 1 && fn in r ? r[fn] : r };
};

// ======================================================================================
// §22 acceptance checks (round 2). Check ids == spec §22 ids. Each check exercises the
// behaviour on the real database through the same RPCs / table APIs the app uses.
// ======================================================================================
async function main() {
  const su = await connect(null);
  log(`# AOMS V2 §22 acceptance DB tests @ ${new Date().toISOString()} db=${PGURL.split('/').pop()}`);
  for (const [k, id] of Object.entries(U)) {
    await su.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing`,
      [id, `${k}@aoms.test`, JSON.stringify({ full_name: k })]);
    const role = k === 'inactive' ? 'operator' : k;
    await su.query(`insert into public.profiles (id, email, full_name, role, status) values ($1,$2,$3,$4,$5)
      on conflict (id) do update set role = excluded.role, status = excluded.status`, [id, `${k}@aoms.test`, k, role, k === 'inactive' ? 'inactive' : 'active']);
  }
  const today = (await one(su, `select (now() at time zone 'Asia/Jerusalem')::date::text d`)).d;
  const day = n => (new Date(Date.parse(today + 'T00:00:00Z') - n * 86400000)).toISOString().slice(0, 10);
  const admin = await connect('admin');
  const operator = await connect('operator');
  const viewer = await connect('viewer');

  const mkCat = (o) => one(admin, `insert into public.categories (name, code_prefix, uses_meter, meter_unit, supports_fuel, default_fuel_rate, fuel_unit, supports_chlorine, default_chlorine_consumption, chlorine_unit)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [o.name, o.prefix, !!o.meter, o.meter ? 'ساعة تشغيل' : null, !!o.fuel, o.rate ?? null, o.fuel ? 'لتر' : null, !!o.chl, o.chlRate ?? null, o.chl ? 'كغم' : null]);
  const mkAsset = async (catId, extra = {}) => (await rpc(admin, 'create_asset', [JSON.stringify({ category_id: catId, name: extra.name || 'أصل', ...extra }), '{}'])).r;
  const getAsset = id => one(su, `select * from public.assets where id=$1`, [id]);
  const fuelBal = async (a, ft) => Number((await one(su, `select coalesce((select balance from public.asset_fuel_balances where asset_id=$1 and fuel_type_id=$2),0) b`, [a, ft])).b);
  const chlBal = async a => Number((await one(su, `select coalesce((select balance from public.asset_chlorine_balances where asset_id=$1),0) b`, [a])).b);
  const saveLog = (c, p, v = {}) => rpc(c, 'save_operation_log', [JSON.stringify(p), JSON.stringify(v)]).then(x => x.r);
  const saveFuel = (c, p) => rpc(c, 'save_fuel_transaction', [JSON.stringify(p)]).then(x => x.r);
  const saveChl = (c, p) => rpc(c, 'save_chlorine_transaction', [JSON.stringify(p)]).then(x => x.r);

  const ft1 = await one(admin, `insert into public.fuel_types (name, unit) values ('ديزل قبول','لتر') returning *`);
  const ft2 = await one(admin, `insert into public.fuel_types (name, unit) values ('بنزين قبول','لتر') returning *`);
  const opr = await one(admin, `insert into public.operators (name, phone) values ('مشغل القبول','0590000000') returning *`);
  const gen = await mkCat({ name: 'مولدات قبول', prefix: 'GNA', meter: true, fuel: true, rate: 2 });
  const pmp = await mkCat({ name: 'مضخات قبول', prefix: 'PMA', meter: true, fuel: false, chl: true, chlRate: 0.5 });
  const tank = await mkCat({ name: 'خزانات قبول', prefix: 'TKA', meter: false, fuel: false, chl: false });

  // ---------------- categories ----------------
  await check('CAT-002', 'empty category name is rejected', () =>
    rejects(admin.query(`insert into public.categories (name, code_prefix) values ('   ','EMP1')`)));
  await check('CAT-003', 'duplicate prefix is rejected even with different case/spaces', () =>
    rejects(admin.query(`insert into public.categories (name, code_prefix) values ('تكرار',' gna ')`), /duplicate|unique|مكرر/i));
  await check('CAT-004', 'meter_unit is cleared when uses_meter=false', async () => {
    const r = await one(admin, `insert into public.categories (name, code_prefix, uses_meter, meter_unit) values ('بلا عداد','NMU1',false,'كيلومتر') returning meter_unit`);
    assert(r.meter_unit === null, `meter_unit=${r.meter_unit}`);
    return 'meter_unit stored as NULL';
  });
  await check('CAT-005', 'meter category without a meter unit is rejected', () =>
    rejects(admin.query(`insert into public.categories (name, code_prefix, uses_meter) values ('عداد بلا وحدة','MNU1',true)`)));
  const seqCat = await mkCat({ name: 'تسلسل قبول', prefix: 'SQA', meter: false });
  const s1 = await mkAsset(seqCat.id); const s2 = await mkAsset(seqCat.id);
  await check('CAT-006', 'a disabled category cannot receive new assets', async () => {
    await admin.query(`update public.categories set status='inactive' where id=$1`, [seqCat.id]);
    return rejects(mkAsset(seqCat.id), /معطل/);
  });
  await check('ASSET-004', 'creating an asset under an inactive category is rejected (same rule via create_asset)', () =>
    rejects(mkAsset(seqCat.id), /معطل/));
  let s3;
  await check('CAT-007', 'reactivating a category makes it usable again', async () => {
    await admin.query(`update public.categories set status='active' where id=$1`, [seqCat.id]);
    s3 = await mkAsset(seqCat.id);
    assert(s3 && s3.id, 'no asset created');
    return `created ${s3.asset_code}`;
  });
  await check('CAT-010', 'code sequence continues without reuse after disable/re-enable', async () => {
    assert(s1.asset_code === 'SQA-0001' && s2.asset_code === 'SQA-0002', `${s1.asset_code},${s2.asset_code}`);
    assert(s3.asset_code === 'SQA-0003', `after reactivation got ${s3.asset_code}`);
    return 'SQA-0001, SQA-0002, (disabled), SQA-0003';
  });
  await check('CAT-011', 'meter category without fuel: usage computed, no fuel consumed', async () => {
    const a = await mkAsset(pmp.id);
    const l = await saveLog(operator, { asset_id: a.id, operation_date: day(5), previous_reading: 10, current_reading: 25, chlorine_consumed: 0 });
    assert(Number(l.usage_value) === 15, `usage=${l.usage_value}`);
    assert(Number(l.fuel_consumed) === 0, `fuel_consumed=${l.fuel_consumed}`);
    return 'usage 15, fuel 0';
  });
  await check('CAT-012', 'non-meter category: readings ignored and not required', async () => {
    const a = await mkAsset(tank.id);
    const l = await saveLog(operator, { asset_id: a.id, operation_date: day(5), previous_reading: 1, current_reading: 9 });
    assert(l.previous_reading === null && l.current_reading === null && l.usage_value === null, JSON.stringify(l));
    const l2 = await saveLog(operator, { asset_id: a.id, operation_date: day(4) });
    assert(l2.id, 'log without readings rejected');
    return 'readings stored NULL; log without readings accepted';
  });

  // ---------------- dynamic fields ----------------
  const fCat = await mkCat({ name: 'حقول قبول', prefix: 'FDA', meter: true, fuel: false });
  const fSerial = await one(admin, `insert into public.category_fields (category_id, scope, field_key, label, field_type, sort_order) values ($1,'asset','serial','الرقم التسلسلي','text',1) returning *`, [fCat.id]);
  await admin.query('begin'); // FIELD-003 (migration 004): select field + options in one transaction
  const fSel = await one(admin, `insert into public.category_fields (category_id, scope, field_key, label, field_type, sort_order) values ($1,'asset','brand','الماركة','select',2) returning *`, [fCat.id]);
  const oUsed = await one(admin, `insert into public.category_field_options (field_id, value_key, label) values ($1,'cat','كاتربيلر') returning *`, [fSel.id]);
  const oFree = await one(admin, `insert into public.category_field_options (field_id, value_key, label) values ($1,'per','بيركنز') returning *`, [fSel.id]);
  await admin.query('commit');
  const fa = (await rpc(admin, 'create_asset', [JSON.stringify({ category_id: fCat.id, name: 'أصل حقول' }), JSON.stringify({ serial: 'SN-77', brand: 'cat' })])).r;
  await check('FIELD-003', 'DB rejects an active select field without an active option (direct API + RPC); atomic RPC save works', async () => {
    const out = [];
    // a lone select field via the table API (what PostgREST would do) fails at commit
    out.push(await rejects(admin.query(`insert into public.category_fields (category_id, scope, field_key, label, field_type) values ($1,'asset','lone_sel','قائمة وحيدة','select')`, [fCat.id]), /FIELD-003/));
    // only inactive options -> rejected
    await admin.query('begin');
    try {
      const f = await one(admin, `insert into public.category_fields (category_id, scope, field_key, label, field_type) values ($1,'asset','dead_sel','قائمة معطلة','select') returning id`, [fCat.id]);
      await admin.query(`insert into public.category_field_options (field_id, value_key, label, is_active) values ($1,'x','خيار معطل',false)`, [f.id]);
      await admin.query('commit');
      throw new Error('commit with only inactive options SUCCEEDED');
    } catch (e) { await admin.query('rollback').catch(() => {}); if (!/FIELD-003/.test(e.message)) throw e; out.push('inactive-only rejected'); }
    // RPC with empty / blank / inactive-only lists -> rejected, nothing written
    for (const opts of [[], [{ label: '  ' }], [{ label: 'قديم', is_active: false }]]) {
      out.push(await rejects(rpc(admin, 'save_category_field', [JSON.stringify({ category_id: fCat.id, scope: 'asset', field_key: 'rpc_sel', label: 'قائمة', field_type: 'select' }), JSON.stringify(opts)]), /FIELD-003/));
    }
    const leaked = Number((await one(su, `select count(*) n from public.category_fields where category_id=$1 and field_key in ('lone_sel','dead_sel','rpc_sel')`, [fCat.id])).n);
    assert(leaked === 0, `rejected fields were written: ${leaked}`);
    // atomic RPC save, then re-save of the same list (edit) does not duplicate, and dropping a label disables it
    const saved = (await rpc(admin, 'save_category_field', [JSON.stringify({ category_id: fCat.id, scope: 'asset', field_key: 'rpc_sel', label: 'قائمة', field_type: 'select' }), JSON.stringify([{ label: 'أ' }, { label: 'ب' }])])).r;
    await rpc(admin, 'save_category_field', [JSON.stringify({ id: saved.id, category_id: fCat.id, scope: 'asset', field_key: 'rpc_sel', label: 'قائمة معدلة', field_type: 'select' }), JSON.stringify([{ label: 'أ' }])]);
    const opts = (await su.query(`select label, is_active from public.category_field_options where field_id=$1 order by label`, [saved.id])).rows;
    assert(JSON.stringify(opts) === JSON.stringify([{ label: 'أ', is_active: true }, { label: 'ب', is_active: false }]), JSON.stringify(opts));
    // the last active option cannot be disabled or deleted while the field is active
    out.push(await rejects(admin.query(`update public.category_field_options set is_active=false where field_id=$1`, [saved.id]), /FIELD-003/));
    out.push(await rejects(su.query(`delete from public.category_field_options where field_id=$1 and is_active`, [saved.id]), /FIELD-003/));
    // disabling the FIELD itself is allowed, after which its options may be disabled
    await admin.query(`update public.category_fields set is_active=false where id=$1`, [saved.id]);
    await admin.query(`update public.category_field_options set is_active=false where field_id=$1`, [saved.id]);
    out.push(await rejects(admin.query(`update public.category_fields set is_active=true where id=$1`, [saved.id]), /FIELD-003/));
    // non-admin cannot use the RPC
    out.push(await rejects(rpc(operator, 'save_category_field', [JSON.stringify({ category_id: fCat.id, scope: 'asset', field_key: 'op_sel', label: 'x', field_type: 'select' }), JSON.stringify([{ label: 'أ' }])])));
    return `${out.length} rejections; edit keeps 1 active + disables dropped option`;
  });
  await check('FIELD-005', 'changing a field label keeps its key and stored values', async () => {
    await admin.query(`update public.category_fields set label='رقم المصنع' where id=$1`, [fSerial.id]);
    const f = await one(su, `select field_key, label from public.category_fields where id=$1`, [fSerial.id]);
    const v = await one(su, `select value_text from public.asset_field_values where asset_id=$1 and field_id=$2`, [fa.id, fSerial.id]);
    assert(f.field_key === 'serial' && f.label === 'رقم المصنع', JSON.stringify(f));
    assert(v && v.value_text === 'SN-77', `value=${JSON.stringify(v)}`);
    const rej = await rejects(admin.query(`update public.category_fields set field_key='serial2' where id=$1`, [fSerial.id]));
    return `key kept, value SN-77 kept; key change on used field ${rej.slice(0, 40)}`;
  });
  await check('FIELD-007', 'disabling a used field keeps its historical values', async () => {
    await admin.query(`update public.category_fields set is_active=false where id=$1`, [fSerial.id]);
    const v = await one(su, `select value_text from public.asset_field_values where asset_id=$1 and field_id=$2`, [fa.id, fSerial.id]);
    assert(v && v.value_text === 'SN-77', 'value lost');
    await rpc(admin, 'update_asset', [fa.id, (await getAsset(fa.id)).version, JSON.stringify({ notes: 'x' }), JSON.stringify({ serial: 'NEW' })]);
    const v2 = await one(su, `select value_text from public.asset_field_values where asset_id=$1 and field_id=$2`, [fa.id, fSerial.id]);
    assert(v2.value_text === 'SN-77', `inactive field was overwritten: ${v2.value_text}`);
    await admin.query(`update public.category_fields set is_active=true where id=$1`, [fSerial.id]);
    return 'value kept; inactive field ignored on save';
  });
  await check('FIELD-008', 'a field added later shows as empty for older records (no backfill, no error)', async () => {
    const fNew = await one(admin, `insert into public.category_fields (category_id, scope, field_key, label, field_type, sort_order) values ($1,'asset','installed','تاريخ التركيب','date',3) returning *`, [fCat.id]);
    const n = Number((await one(su, `select count(*) n from public.asset_field_values where field_id=$1`, [fNew.id])).n);
    assert(n === 0, `backfilled ${n}`);
    const rows = (await viewer.query(`select a.asset_code, v.value_date from public.assets a left join public.asset_field_values v on v.asset_id=a.id and v.field_id=$1 where a.id=$2`, [fNew.id, fa.id])).rows;
    assert(rows.length === 1 && rows[0].value_date === null, JSON.stringify(rows));
    return 'old asset reads the new field as empty';
  });
  const opA = await mkAsset(fCat.id, { name: 'سجلات حقول' });
  const oldLog = await saveLog(operator, { asset_id: opA.id, operation_date: day(6), previous_reading: 0, current_reading: 5 });
  const reqField = await one(admin, `insert into public.category_fields (category_id, scope, field_key, label, field_type, is_required) values ($1,'operation','pressure','الضغط','number',true) returning *`, [fCat.id]);
  await check('FIELD-009', 'adding a required field later does not break reading old records', async () => {
    const r = await viewer.query(`select l.id, l.usage_value from public.operation_logs l where l.id=$1`, [oldLog.id]);
    assert(r.rows.length === 1 && Number(r.rows[0].usage_value) === 5, 'old log unreadable');
    const b = (await rpc(admin, 'export_aoms_backup', [])).r;
    assert(b.operation_logs.some(x => x.id === oldLog.id), 'old log missing from backup export');
    return 'old log readable + exported; required_since=' + (reqField.required_since ? 'set' : 'null');
  });
  await check('FIELD-010', 'editing an old record after a new required field requires the value', async () => {
    const rej = await rejects(saveLog(operator, { id: oldLog.id, version: oldLog.version, operation_date: day(6), previous_reading: 0, current_reading: 6 }), /مطلوب/);
    const ok = await saveLog(operator, { id: oldLog.id, version: oldLog.version, operation_date: day(6), previous_reading: 0, current_reading: 6 }, { pressure: 3 });
    assert(Number(ok.usage_value) === 6, 'edit with value failed');
    return rej.slice(0, 60) + ' / with value: saved';
  });
  await check('FIELD-012', 'a used select option cannot be physically deleted (API role and, defence in depth, the trigger)', async () => {
    const r1 = await rejects(admin.query(`delete from public.category_field_options where id=$1`, [oUsed.id]));
    const r2 = await rejects(su.query(`delete from public.category_field_options where id=$1`, [oUsed.id]), /تاريخي/);
    const still = Number((await one(su, `select count(*) n from public.category_field_options where id=$1`, [oUsed.id])).n);
    assert(still === 1, 'option row gone');
    return `API: ${r1.slice(10, 50)} / trigger (even as table owner): ${r2.slice(10, 60)}`;
  });

  // ---------------- assets ----------------
  const dCat = await mkCat({ name: 'افتراضي قبول', prefix: 'DFA', meter: false });
  const only = await mkAsset(dCat.id, { is_default: true });
  await check('ASSET-008', 'deactivating the only (default) asset leaves the category without a default', async () => {
    await rpc(admin, 'update_asset', [only.id, (await getAsset(only.id)).version, JSON.stringify({ status: 'inactive' }), '{}']);
    const n = Number((await one(su, `select count(*) n from public.assets where category_id=$1 and is_default`, [dCat.id])).n);
    assert(n === 0, `${n} defaults`);
    return 'no default, no error';
  });
  await check('ASSET-009', 'inactive asset: no new log/fuel/chlorine, but still readable', async () => {
    const r1 = await rejects(saveLog(operator, { asset_id: only.id, operation_date: day(1) }), /غير نشط/);
    const g = await mkAsset(gen.id); await rpc(admin, 'update_asset', [g.id, 1, JSON.stringify({ status: 'inactive' }), '{}']);
    await rejects(saveFuel(operator, { asset_id: g.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: 5 }), /غير نشط/);
    const p = await mkAsset(pmp.id); await rpc(admin, 'update_asset', [p.id, 1, JSON.stringify({ status: 'inactive' }), '{}']);
    await rejects(saveChl(operator, { asset_id: p.id, transaction_date: day(1), transaction_type: 'receipt', quantity: 5 }), /غير نشط/);
    const seen = (await viewer.query(`select id from public.assets where id = any($1)`, [[only.id, g.id, p.id]])).rows.length;
    assert(seen === 3, `viewer sees ${seen}/3`);
    return 'log/fuel/chlorine rejected; viewer reads all 3 inactive assets';
  });
  await check('OPLOG-010', 'a new operation log for an inactive asset is rejected', () =>
    rejects(saveLog(operator, { asset_id: only.id, operation_date: day(2) }), /غير نشط/));
  await check('ASSET-006', 'an inactive asset cannot become the default (set_default_asset and create_asset)', async () => {
    const r1 = await rejects(rpc(admin, 'set_default_asset', [only.id]), /غير نشط/);
    let r2;
    try {
      const created = await mkAsset(dCat.id, { name: 'معطل افتراضي', status: 'inactive', is_default: true });
      const row = await getAsset(created.id);
      assert(!(row.status === 'inactive' && row.is_default), `created inactive default asset ${row.asset_code}`);
      r2 = `create_asset stored status=${row.status} is_default=${row.is_default}`;
    } catch (e) { if (/expected|created inactive/.test(e.message)) throw e; r2 = `create_asset rejected: ${e.message.slice(0, 80)}`; }
    const n = Number((await one(su, `select count(*) n from public.assets where status<>'active' and is_default`)).n);
    assert(n === 0, `${n} inactive default assets`);
    return `${r1.slice(0, 80)} | ${r2}`;
  });
  await check('ASSET-010', 'reactivating an asset does not make it default automatically', async () => {
    const x = await mkAsset(dCat.id, { name: 'بديل' });
    const r = await rpc(admin, 'update_asset', [only.id, (await getAsset(only.id)).version, JSON.stringify({ status: 'active' }), '{}']);
    assert(r.r.status === 'active' && r.r.is_default === false, JSON.stringify({ s: r.r.status, d: r.r.is_default }));
    return `reactivated, is_default=false (other asset ${x.asset_code})`;
  });
  await check('ASSET-011', 'physical delete of an asset is rejected even for admin', () =>
    rejects(admin.query(`delete from public.assets where id=$1`, [only.id])));
  const inh = await mkAsset(gen.id, { name: 'وراثة' });
  const ovr = await mkAsset(gen.id, { name: 'تجاوز', has_fuel_rate_override: true, fuel_rate_override: 5 });
  await saveFuel(operator, { asset_id: inh.id, fuel_type_id: ft1.id, transaction_date: day(9), transaction_type: 'supply', quantity: 1000 });
  await saveFuel(operator, { asset_id: ovr.id, fuel_type_id: ft1.id, transaction_date: day(9), transaction_type: 'supply', quantity: 1000 });
  await check('ASSET-012', 'inheriting asset uses the CURRENT category rate (after the category changes)', async () => {
    await admin.query(`update public.categories set default_fuel_rate=3 where id=$1`, [gen.id]);
    const l = await saveLog(operator, { asset_id: inh.id, operation_date: day(8), previous_reading: 0, current_reading: 10, fuel_type_id: ft1.id });
    assert(Number(l.effective_fuel_rate) === 3 && Number(l.fuel_consumed) === 30, `rate=${l.effective_fuel_rate} fuel=${l.fuel_consumed}`);
    return 'rate 3 → 30 L';
  });
  await check('ASSET-013', 'asset override is kept after the category value changes', async () => {
    const l = await saveLog(operator, { asset_id: ovr.id, operation_date: day(8), previous_reading: 0, current_reading: 10, fuel_type_id: ft1.id });
    assert(Number(l.effective_fuel_rate) === 5 && Number(l.fuel_consumed) === 50, `rate=${l.effective_fuel_rate}`);
    return 'rate 5 → 50 L';
  });
  await check('OPLOG-017', 'asset override takes precedence over the category default in the calculation', async () => {
    const l = await one(su, `select effective_fuel_rate r from public.operation_logs where asset_id=$1`, [ovr.id]);
    const c = await one(su, `select default_fuel_rate r from public.categories where id=$1`, [gen.id]);
    assert(Number(l.r) === 5 && Number(c.r) === 3, `log ${l.r} cat ${c.r}`);
    return 'override 5 used, category 3 ignored';
  });
  await check('ASSET-014', 'removing the override returns the asset to inheritance', async () => {
    const u = (await rpc(admin, 'update_asset', [ovr.id, (await getAsset(ovr.id)).version, JSON.stringify({ has_fuel_rate_override: false }), '{}'])).r;
    assert(u.has_fuel_rate_override === false && u.fuel_rate_override === null, JSON.stringify(u));
    const l = await saveLog(operator, { asset_id: ovr.id, operation_date: day(7), current_reading: 20, fuel_type_id: ft1.id });
    assert(Number(l.effective_fuel_rate) === 3 && Number(l.fuel_consumed) === 30, `rate=${l.effective_fuel_rate}`);
    return 'override cleared; next log uses category rate 3';
  });

  // ---------------- operators ----------------
  const pA = await mkAsset(pmp.id, { name: 'مشغلين' });
  const opLog = await saveLog(operator, { asset_id: pA.id, operation_date: day(4), previous_reading: 0, current_reading: 3, operator_id: opr.id, chlorine_consumed: 0 });
  await admin.query(`update public.operators set status='inactive' where id=$1`, [opr.id]);
  await check('OPERATOR-002', 'an inactive operator cannot be chosen for a new log', () =>
    rejects(saveLog(operator, { asset_id: pA.id, operation_date: day(3), current_reading: 4, operator_id: opr.id, chlorine_consumed: 0 }), /غير نشط/));
  await check('OPERATOR-003', 'inactive operator name stays in historical records', async () => {
    const r = await one(viewer, `select o.name, o.status from public.operation_logs l join public.operators o on o.id=l.operator_id where l.id=$1`, [opLog.id]);
    assert(r && r.name === 'مشغل القبول' && r.status === 'inactive', JSON.stringify(r));
    return 'history shows «مشغل القبول» (inactive)';
  });
  await check('OPLOG-015', 'editing an old log keeps its (now inactive) operator', async () => {
    const e = await saveLog(operator, { id: opLog.id, version: opLog.version, operation_date: day(4), current_reading: 3.5, operator_id: opr.id, chlorine_consumed: 0, previous_reading: 0 });
    assert(e.operator_id === opr.id, 'operator dropped');
    return 'edit accepted with inactive operator kept';
  });
  await check('OPERATOR-004', 'reactivated operator can be selected again', async () => {
    await admin.query(`update public.operators set status='active' where id=$1`, [opr.id]);
    const l = await saveLog(operator, { asset_id: pA.id, operation_date: day(3), current_reading: 4, operator_id: opr.id, chlorine_consumed: 0 });
    assert(l.operator_id === opr.id, 'not saved');
    return 'new log with reactivated operator saved';
  });
  await check('OPERATOR-005', 'physical delete of an operator is rejected', () =>
    rejects(admin.query(`delete from public.operators where id=$1`, [opr.id])));

  // ---------------- operation logs ----------------
  await check('OPLOG-007', 'daily log with current < previous reading is rejected', async () => {
    const a = await mkAsset(pmp.id);
    await saveLog(operator, { asset_id: a.id, operation_date: day(5), previous_reading: 0, current_reading: 50, chlorine_consumed: 0 });
    return rejects(saveLog(operator, { asset_id: a.id, operation_date: day(4), current_reading: 40, chlorine_consumed: 0 }), /لا تقل/);
  });
  await check('OPLOG-013', 'changing the asset while editing a log is rejected', async () => {
    const l = await one(su, `select * from public.operation_logs where asset_id=$1 order by operation_date desc limit 1`, [pA.id]);
    return rejects(saveLog(operator, { id: l.id, version: l.version, asset_id: inh.id, operation_date: l.operation_date, current_reading: 9 }), /تغيير الأصل/);
  });
  await check('OPLOG-018', 'meter category without fuel never calculates fuel', async () => {
    const r = await su.query(`select fuel_consumed, effective_fuel_rate from public.operation_logs l join public.assets a on a.id=l.asset_id where a.category_id=$1`, [pmp.id]);
    assert(r.rows.length > 0 && r.rows.every(x => Number(x.fuel_consumed) === 0 && x.effective_fuel_rate === null), JSON.stringify(r.rows));
    return `${r.rows.length} pump logs: fuel 0, rate NULL`;
  });
  await check('OPLOG-019', 'chlorine consumption is only recorded for chlorine-eligible categories', async () => {
    const t = await mkAsset(tank.id);
    const l = await saveLog(operator, { asset_id: t.id, operation_date: day(2), chlorine_consumed: 7, residual_chlorine: 1 });
    assert(Number(l.chlorine_consumed) === 0 && l.residual_chlorine === null, JSON.stringify({ c: l.chlorine_consumed, r: l.residual_chlorine }));
    return 'non-eligible: chlorine forced to 0 / residual NULL';
  });
  await check('OPLOG-020', 'editing the last log recalculates the fuel balance', async () => {
    const before = await fuelBal(inh.id, ft1.id); // 1000 - 30
    const l = await one(su, `select * from public.operation_logs where asset_id=$1 order by operation_date desc limit 1`, [inh.id]);
    await saveLog(operator, { id: l.id, version: l.version, operation_date: l.operation_date, previous_reading: 0, current_reading: 20, fuel_type_id: ft1.id });
    const after = await fuelBal(inh.id, ft1.id);
    assert(before === 970 && after === 940, `before ${before} after ${after}`);
    return 'balance 970 → 940 after usage 10→20 (rate 3)';
  });
  await check('OPLOG-021', 'create/edit/delete of a log write timeline + audit entries', async () => {
    const l = await one(su, `select * from public.operation_logs where asset_id=$1 order by operation_date desc limit 1`, [inh.id]);
    await rpc(operator, 'delete_operation_log', [l.id, l.version]);
    const t = (await su.query(`select event_type from public.timeline_events where entity_id=$1 order by created_at`, [l.id])).rows.map(x => x.event_type);
    const a = (await su.query(`select action from public.audit_logs where entity_id=$1 order by created_at`, [l.id])).rows.map(x => x.action);
    assert(['operation_created', 'operation_updated', 'operation_deleted'].every(e => t.includes(e)), `timeline ${t}`);
    assert(['create', 'update', 'delete'].every(e => a.includes(e)), `audit ${a}`);
    return `timeline [${t}] audit [${a}]`;
  });
  await check('AUDIT-004', 'deleting a functional record does not delete its audit trail', async () => {
    const l = (await one(su, `select entity_id from public.audit_logs where action='delete' and entity_type='operation_log' limit 1`)).entity_id;
    const gone = Number((await one(su, `select count(*) n from public.operation_logs where id=$1`, [l])).n);
    const n = Number((await one(su, `select count(*) n from public.audit_logs where entity_id=$1`, [l])).n);
    assert(gone === 0 && n >= 3, `log rows ${gone}, audit rows ${n}`);
    await rejects(admin.query(`delete from public.audit_logs where entity_id=$1`, [l]));
    return `record gone, ${n} audit rows remain; audit delete rejected`;
  });
  await check('AUDIT-002', 'audit rows carry the acting user and the current time', async () => {
    const r = await one(su, `select user_id, extract(epoch from now()-created_at) age from public.audit_logs where entity_type='operation_log' and action='delete' order by created_at desc limit 1`);
    const r2 = await one(su, `select user_id from public.audit_logs where entity_type='asset' and action='create' order by created_at desc limit 1`);
    assert(r.user_id === U.operator && r2.user_id === U.admin, `${r.user_id} / ${r2.user_id}`);
    assert(Number(r.age) >= 0 && Number(r.age) < 120, `age ${r.age}s`);
    return `operator/admin ids correct, age ${Number(r.age).toFixed(2)}s`;
  });

  // ---------------- fuel ----------------
  const fa1 = await mkAsset(gen.id, { name: 'وقود 1' });
  const fa2 = await mkAsset(gen.id, { name: 'وقود 2' });
  await check('FUEL-012', 'supplier is free text and invoice number is optional', async () => {
    const t = await saveFuel(operator, { asset_id: fa1.id, fuel_type_id: ft1.id, transaction_date: day(9), transaction_type: 'supply', quantity: 100, supplier: 'مورد حر 123 — أي نص' });
    assert(t.supplier === 'مورد حر 123 — أي نص' && t.invoice_number === null, JSON.stringify(t));
    return 'saved without invoice';
  });
  await check('FUEL-009', 'fuel balance is separate per asset and per fuel type', async () => {
    await saveFuel(operator, { asset_id: fa1.id, fuel_type_id: ft2.id, transaction_date: day(9), transaction_type: 'supply', quantity: 40 });
    await saveFuel(operator, { asset_id: fa2.id, fuel_type_id: ft1.id, transaction_date: day(9), transaction_type: 'supply', quantity: 7 });
    const b = [await fuelBal(fa1.id, ft1.id), await fuelBal(fa1.id, ft2.id), await fuelBal(fa2.id, ft1.id), await fuelBal(fa2.id, ft2.id)];
    assert(JSON.stringify(b) === '[100,40,7,0]', JSON.stringify(b));
    return 'a1/diesel 100, a1/petrol 40, a2/diesel 7, a2/petrol 0';
  });
  await check('FUEL-002', 'inactive fuel type is rejected for new transactions; old transactions kept', async () => {
    await admin.query(`update public.fuel_types set status='inactive' where id=$1`, [ft2.id]);
    const r = await rejects(saveFuel(operator, { asset_id: fa2.id, fuel_type_id: ft2.id, transaction_date: day(8), transaction_type: 'supply', quantity: 1 }), /غير نشط|غير صالح/);
    const kept = Number((await one(viewer, `select count(*) n from public.fuel_transactions where fuel_type_id=$1`, [ft2.id])).n);
    assert(kept === 1 && (await fuelBal(fa1.id, ft2.id)) === 40, `kept ${kept}`);
    await admin.query(`update public.fuel_types set status='active' where id=$1`, [ft2.id]);
    return r.slice(0, 50) + ` / ${kept} old tx + balance 40 kept`;
  });
  await check('FUEL-003', 'a used fuel type cannot be deleted (API role and, defence in depth, the trigger)', async () => {
    const r1 = await rejects(admin.query(`delete from public.fuel_types where id=$1`, [ft1.id]));
    const r2 = await rejects(su.query(`delete from public.fuel_types where id=$1`, [ft1.id]), /مستخدم/);
    const ft3 = await one(su, `insert into public.fuel_types (name, unit) values ('غير مستخدم','لتر') returning id`);
    const d = await su.query(`delete from public.fuel_types where id=$1`, [ft3.id]);
    assert(d.rowCount === 1, 'trigger also blocks unused types');
    return `API: ${r1.slice(10, 50)} / trigger: ${r2.slice(10, 50)} / unused type passes the trigger`;
  });
  await check('FUEL-005', 'fuel transaction for a non-fuel category or inactive asset is rejected', async () => {
    const p = await mkAsset(pmp.id);
    const r1 = await rejects(saveFuel(operator, { asset_id: p.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: 5 }), /لا يدعم الوقود/);
    const g = await mkAsset(gen.id); await rpc(admin, 'update_asset', [g.id, 1, JSON.stringify({ status: 'inactive' }), '{}']);
    const r2 = await rejects(saveFuel(operator, { asset_id: g.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: 5 }), /غير نشط/);
    return 'non-fuel category and inactive asset both rejected';
  });
  await check('FUEL-006', 'quantity must be > 0 (0 and negative rejected)', async () => {
    await rejects(saveFuel(operator, { asset_id: fa2.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: 0 }), /موجب/);
    await rejects(saveFuel(operator, { asset_id: fa2.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: -3 }), /موجب/);
    await rejects(admin.query(`update public.fuel_transactions set quantity=0 where asset_id=$1`, [fa2.id]));
    return '0, -3 rejected by RPC; direct UPDATE rejected';
  });
  await check('FUEL-007', 'adjustment without a reason is rejected', () =>
    rejects(saveFuel(operator, { asset_id: fa1.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'adjustment_minus', quantity: 1 }), /سبب/));
  await check('FUEL-011', 'editing and deleting the last fuel transaction update the balance immediately', async () => {
    const t = await saveFuel(operator, { asset_id: fa1.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: 50 });
    const b1 = await fuelBal(fa1.id, ft1.id);
    const e = await saveFuel(operator, { id: t.id, version: t.version, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: 20 });
    const b2 = await fuelBal(fa1.id, ft1.id);
    await rpc(operator, 'delete_fuel_transaction', [e.id, e.version]);
    const b3 = await fuelBal(fa1.id, ft1.id);
    assert(b1 === 150 && b2 === 120 && b3 === 100, `${b1},${b2},${b3}`);
    return 'balance 150 → 120 (edit) → 100 (delete)';
  });
  await check('FUEL-010', 'only the last fuel transaction can be edited/deleted', async () => {
    const first = await one(su, `select * from public.fuel_transactions where asset_id=$1 order by transaction_date asc, created_at asc limit 1`, [fa1.id]);
    await rejects(saveFuel(operator, { id: first.id, version: first.version, fuel_type_id: ft1.id, transaction_date: first.transaction_date, transaction_type: 'supply', quantity: 99 }), /آخر/);
    await rejects(rpc(operator, 'delete_fuel_transaction', [first.id, first.version]), /آخر/);
    return 'edit + delete of older tx rejected';
  });
  await check('FUEL-013', 'no price/cost columns exist in the fuel/chlorine model', async () => {
    const r = await su.query(`select table_name, column_name from information_schema.columns where table_schema='public'
      and column_name ~* '(price|cost|amount|money|currency|total_value)'`);
    assert(r.rows.length === 0, JSON.stringify(r.rows));
    return 'no price/cost/amount column in any table';
  });

  // ---------------- chlorine ----------------
  const ca = await mkAsset(pmp.id, { name: 'كلور' });
  await check('CHL-002', 'chlorine transaction for a non-chlorine category is rejected', async () => {
    const g = await mkAsset(gen.id);
    return rejects(saveChl(operator, { asset_id: g.id, transaction_date: day(1), transaction_type: 'receipt', quantity: 5 }), /كلور|لا يدعم/);
  });
  await check('CHL-003', 'chlorine adjustment without a reason is rejected', () =>
    rejects(saveChl(operator, { asset_id: ca.id, transaction_date: day(1), transaction_type: 'adjustment_plus', quantity: 1 }), /سبب/));
  await check('CHL-005', 'only the last chlorine transaction can be edited/deleted', async () => {
    const t1 = await saveChl(operator, { asset_id: ca.id, transaction_date: day(9), transaction_type: 'receipt', quantity: 10 });
    const t2 = await saveChl(operator, { asset_id: ca.id, transaction_date: day(8), transaction_type: 'receipt', quantity: 5 });
    await rejects(saveChl(operator, { id: t1.id, version: t1.version, transaction_date: day(9), transaction_type: 'receipt', quantity: 11 }), /آخر/);
    await rejects(rpc(operator, 'delete_chlorine_transaction', [t1.id, t1.version]), /آخر/);
    const e = await saveChl(operator, { id: t2.id, version: t2.version, transaction_date: day(8), transaction_type: 'receipt', quantity: 6 });
    assert(Number(e.quantity) === 6 && (await chlBal(ca.id)) === 16, 'last edit failed');
    return 'older tx edit/delete rejected; last edited (balance 16)';
  });
  await check('CHL-006', 'chlorine unit is a fixed category-level unit (kg) used consistently', async () => {
    const c = await one(su, `select chlorine_unit from public.categories where id=$1`, [pmp.id]);
    const cols = (await su.query(`select column_name from information_schema.columns where table_schema='public' and table_name in ('chlorine_transactions','operation_logs') and column_name like '%unit%'`)).rows;
    assert(c.chlorine_unit === 'كغم' && cols.length === 0, JSON.stringify({ c, cols }));
    return 'unit stored once on category; no per-transaction unit column';
  });
  await check('CHL-007', 'editing an operation log\'s chlorine consumption recalculates the chlorine balance', async () => {
    const l = await saveLog(operator, { asset_id: ca.id, operation_date: day(5), previous_reading: 0, current_reading: 1, chlorine_consumed: 4 });
    const b1 = await chlBal(ca.id);
    await saveLog(operator, { id: l.id, version: l.version, operation_date: day(5), previous_reading: 0, current_reading: 1, chlorine_consumed: 1.5 });
    const b2 = await chlBal(ca.id);
    assert(b1 === 12 && b2 === 14.5, `${b1} → ${b2}`);
    return 'balance 12 → 14.5';
  });
  await check('CHL-008', 'no price/cost on chlorine transactions', async () => {
    const r = await su.query(`select column_name from information_schema.columns where table_schema='public' and table_name='chlorine_transactions'`);
    const bad = r.rows.filter(x => /price|cost|amount/i.test(x.column_name));
    assert(bad.length === 0, JSON.stringify(bad));
    return `${r.rows.length} columns, none monetary`;
  });

  // ---------------- search / timeline / backup ----------------
  await check('SEARCH-002', 'global search covers the six entity types', async () => {
    await saveFuel(operator, { asset_id: fa2.id, fuel_type_id: ft1.id, transaction_date: day(1), transaction_type: 'supply', quantity: 1, notes: 'زقزوق-بحث' });
    await saveChl(operator, { asset_id: ca.id, transaction_date: day(1), transaction_type: 'receipt', quantity: 1, notes: 'زقزوق-بحث' });
    const a = await mkAsset(tank.id, { name: 'أصل زقزوق-بحث' });
    await saveLog(operator, { asset_id: a.id, operation_date: day(1), notes: 'زقزوق-بحث' });
    await admin.query(`insert into public.operators (name) values ('زقزوق-بحث مشغل')`);
    await admin.query(`update public.categories set description='زقزوق-بحث' where id=$1`, [tank.id]);
    const types = new Set((await viewer.query(`select entity_type from public.global_search('زقزوق-بحث')`)).rows.map(x => x.entity_type));
    const need = ['category', 'asset', 'operator', 'operation_log', 'fuel_transaction', 'chlorine_transaction'];
    assert(need.every(t => types.has(t)), `got ${[...types]}`);
    return [...types].join(',');
  });
  await check('TIME-001', 'asset timeline records all important events', async () => {
    const t = new Set((await su.query(`select event_type from public.timeline_events`)).rows.map(x => x.event_type));
    const need = ['asset_created', 'default_set', 'asset_deactivated', 'asset_reactivated', 'asset_updated', 'operation_created', 'operation_updated', 'operation_deleted',
      'fuel_created', 'fuel_updated', 'fuel_deleted', 'chlorine_created', 'chlorine_updated'];
    const miss = need.filter(e => !t.has(e));
    assert(miss.length === 0, `missing ${miss}; have ${[...t]}`);
    return `${t.size} event types incl. ${need.length} required`;
  });
  await check('BACKUP-002', 'backup export contains no passwords, tokens or secrets', async () => {
    await su.query(`update auth.users set encrypted_password='$2a$10$SECRETHASHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' where id=$1`, [U.admin]).catch(() => {});
    const b = (await rpc(admin, 'export_aoms_backup', [])).r;
    const s = JSON.stringify(b);
    const bad = ['encrypted_password', 'password', 'SECRETHASH', 'service_role', 'access_token', 'refresh_token', 'jwt', 'api_key', 'apikey'].filter(k => s.toLowerCase().includes(k.toLowerCase()));
    assert(bad.length === 0, `found ${bad}`);
    const pk = Object.keys(b.profiles[0] || {}).sort().join(',');
    assert(pk === 'email,full_name,id,role,status', pk);
    return `${(s.length / 1024).toFixed(0)} KB; profile keys ${pk}`;
  });

  for (const c of [admin, operator, viewer, su]) await c.end();
  const pass = results.filter(r => r.ok).length;
  log(`\n# SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
