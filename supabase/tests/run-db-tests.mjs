// AOMS V2 — real PostgreSQL integration & concurrency tests.
// Usage: PGURL=postgres://postgres@127.0.0.1:54329/<db> node supabase/tests/run-db-tests.mjs
// The DB must contain supabase/tests/00_supabase_stub.sql + all migrations.
// Every check states the spec expectation; FAIL means the database violates it.
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

async function main() {
  const su = await connect(null);
  log(`# AOMS V2 DB tests @ ${new Date().toISOString()} db=${PGURL.split('/').pop()}`);
  log('# server: ' + (await one(su, 'select version() v')).v);
  const migs = (await su.query(`select key, value from public.app_settings where key like 'schema%' order by key`)).rows;
  log('# settings: ' + JSON.stringify(migs));

  // ---------- fixtures ----------
  for (const [k, id] of Object.entries(U)) {
    await su.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing`,
      [id, `${k}@aoms.test`, JSON.stringify({ full_name: k })]);
  }
  const autoProfile = await one(su, `select role, status from public.profiles where id = $1`, [U.viewer]);
  for (const [k, id] of Object.entries(U)) {
    const role = k === 'inactive' ? 'operator' : k;
    const status = k === 'inactive' ? 'inactive' : 'active';
    await su.query(`insert into public.profiles (id, email, full_name, role, status) values ($1,$2,$3,$4,$5)
      on conflict (id) do update set role = excluded.role, status = excluded.status`, [id, `${k}@aoms.test`, k, role, status]);
  }
  const today = (await one(su, `select (now() at time zone 'Asia/Jerusalem')::date::text d`)).d;
  const day = n => (new Date(Date.parse(today + 'T00:00:00Z') - n * 86400000)).toISOString().slice(0, 10);

  const admin = await connect('admin');
  const operator = await connect('operator');
  const viewer = await connect('viewer');
  const inactive = await connect('inactive');
  const anon = await connect('anon');

  // ---------- 1. structure ----------
  await check('DB-STRUCT-01', 'RLS enabled on all 15 application tables', async () => {
    const r = await su.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' order by 1`);
    const off = r.rows.filter(x => !x.relrowsecurity).map(x => x.relname);
    assert(r.rows.length === 15, `expected 15 tables, found ${r.rows.length}`);
    assert(off.length === 0, `RLS disabled on ${off}`);
    return `${r.rows.length} tables, RLS on all`;
  });
  await check('DB-STRUCT-02', 'every SECURITY DEFINER function pins search_path', async () => {
    const r = await su.query(`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef`);
    const bad = r.rows.filter(x => !(x.proconfig || []).some(s => s.startsWith('search_path='))).map(x => x.proname);
    assert(bad.length === 0, `missing search_path: ${bad}`);
    return `${r.rows.length} SECURITY DEFINER functions OK`;
  });
  await check('DB-STRUCT-03', 'date-sensitive RPCs run in the business time zone', async () => {
    const r = await su.query(`select proname, proconfig from pg_proc where proname in
      ('save_operation_log','save_fuel_transaction','save_chlorine_transaction','restore_aoms_backup')`);
    const bad = r.rows.filter(x => !(x.proconfig || []).some(s => s.toLowerCase().startsWith('timezone='))).map(x => x.proname);
    assert(bad.length === 0, `no timezone pinned (current_date = server UTC day): ${bad}`);
    return 'timezone pinned on 4 RPCs';
  });
  await check('DB-STRUCT-04', 'all tables published to supabase_realtime (needed for postgres_changes)', async () => {
    const n = Number((await one(su, `select count(*) n from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'`)).n);
    assert(n >= 15, `only ${n} tables in publication`);
    return `${n} tables`;
  });
  await check('AUTH-NEWUSER', 'new auth user automatically gets a profile (viewer, inactive)', async () => {
    assert(autoProfile, 'no profile row created for new auth.users row');
    assert(autoProfile.role === 'viewer' && autoProfile.status === 'inactive', JSON.stringify(autoProfile));
    return JSON.stringify(autoProfile);
  });

  // ---------- 2. privileges / RLS ----------
  await check('SEC-ANON-01', 'anon cannot read application tables', async () => {
    try {
      const r = await anon.query('select count(*) n from public.categories');
      assert(Number(r.rows[0].n) === 0, 'anon read rows');
      return 'no rows (RLS)';
    } catch (e) { return 'permission denied: ' + e.message.slice(0, 60); }
  });
  await check('SEC-ANON-02', 'anon cannot execute validate_and_save_dynamic_values', () =>
    rejects(anon.query(`select public.validate_and_save_dynamic_values(gen_random_uuid(),'asset',gen_random_uuid(),'{}'::jsonb, now())`)));
  await check('SEC-AUTH-01', 'operator cannot call validate_and_save_dynamic_values directly (bypass of RPC rules)', () =>
    rejects(operator.query(`select public.validate_and_save_dynamic_values(gen_random_uuid(),'asset',gen_random_uuid(),'{}'::jsonb, now())`)));
  await check('SEC-AUTH-02', 'admin cannot hard-DELETE a category via PostgREST role', () =>
    rejects(admin.query(`delete from public.categories where false`)));
  await check('SEC-AUTH-03', 'authenticated cannot TRUNCATE tables', () =>
    rejects(admin.query(`truncate public.operation_logs`)));
  await check('SEC-AUTH-04', 'admin cannot INSERT assets directly (must go through create_asset)', () =>
    rejects(admin.query(`insert into public.assets (asset_code,name,category_id) select 'X-1','x',id from public.categories limit 1`)));
  await check('AUTH-INACTIVE', 'inactive user reads nothing', async () => {
    const n = Number((await one(inactive, 'select count(*) n from public.profiles')).n);
    assert(n === 0, `inactive user sees ${n} profiles`);
    return '0 rows';
  });

  // ---------- 3. master data ----------
  const fuel = await one(admin, `insert into public.fuel_types (name, unit) values ('ديزل اختبار','لتر') returning *`);
  const cat = await one(admin, `insert into public.categories (name, code_prefix, uses_meter, meter_unit, supports_fuel, default_fuel_rate, fuel_unit, supports_chlorine, default_chlorine_consumption)
    values ('مولدات اختبار','GEN',true,'ساعة تشغيل',true,2,'لتر',true,null) returning *`);
  await check('AUTH-008', 'created_by/updated_by stamped from auth.uid() on direct admin writes', async () => {
    assert(cat.created_by === U.admin && cat.updated_by === U.admin, `created_by=${cat.created_by} updated_by=${cat.updated_by}`);
    return 'stamped';
  });
  const fields = {};
  await admin.query('begin'); // FIELD-003 (migration 004): select field + options in one transaction
  for (const [key, type] of [['f_text', 'text'], ['f_num', 'number'], ['f_date', 'date'], ['f_bool', 'boolean'], ['f_sel', 'select']]) {
    fields[key] = await one(admin, `insert into public.category_fields (category_id, scope, field_key, label, field_type) values ($1,'asset',$2,$2,$3) returning *`, [cat.id, key, type]);
  }
  const optA = await one(admin, `insert into public.category_field_options (field_id, value_key, label) values ($1,'opt_a','خيار ألفا') returning *`, [fields.f_sel.id]);
  const optB = await one(admin, `insert into public.category_field_options (field_id, value_key, label, is_active) values ($1,'opt_b','خيار بيتا', false) returning *`, [fields.f_sel.id]);
  await admin.query('commit');
  const opReq = await one(admin, `insert into public.category_fields (category_id, scope, field_key, label, field_type, is_required) values ($1,'operation','temp','الحرارة','number',true) returning *`, [cat.id]);
  const operatorRow = await one(admin, `insert into public.operators (name) values ('مشغل اختبار') returning *`);

  await check('SYNC-008', 'optimistic version: stale version update affects 0 rows; version bumps', async () => {
    const r1 = await admin.query(`update public.categories set description='v2' where id=$1 and version=$2 returning version`, [cat.id, cat.version]);
    const r2 = await admin.query(`update public.categories set description='stale' where id=$1 and version=$2 returning version`, [cat.id, cat.version]);
    assert(r1.rowCount === 1, 'first update failed');
    assert(r2.rowCount === 0, `stale update with version ${cat.version} SUCCEEDED (version not bumped: ${r1.rows[0].version})`);
    return `version ${cat.version} -> ${r1.rows[0].version}, stale write rejected`;
  });
  await check('AUDIT-001', 'admin edit of a category writes an audit_logs row', async () => {
    const n = Number((await one(su, `select count(*) n from public.audit_logs where entity_id=$1`, [cat.id])).n);
    assert(n >= 1, 'no audit row for category create/update');
    return `${n} audit rows`;
  });

  // ---------- 4. asset codes under concurrency ----------
  await check('ASSET-CODE-RACE', '24 parallel create_asset calls on 8 sessions -> unique contiguous codes', async () => {
    const sess = await Promise.all(Array.from({ length: 8 }, () => connect('admin')));
    const jobs = [];
    for (let i = 0; i < 24; i++) {
      jobs.push(rpc(sess[i % 8], 'create_asset', [JSON.stringify({ category_id: cat.id, name: `مولد ${i}`, is_default: i === 0 }), '{}']));
    }
    const out = await Promise.allSettled(jobs);
    await Promise.all(sess.map(s => s.end()));
    const errs = out.filter(o => o.status === 'rejected').map(o => o.reason.message);
    assert(errs.length === 0, `errors: ${errs.slice(0, 2)}`);
    const codes = (await su.query(`select asset_code from public.assets where category_id=$1 order by 1`, [cat.id])).rows.map(r => r.asset_code);
    const expected = Array.from({ length: 24 }, (_, i) => `GEN-${String(i + 1).padStart(4, '0')}`);
    assert(JSON.stringify(codes) === JSON.stringify(expected), `codes=${codes}`);
    return `${codes[0]}..${codes.at(-1)}`;
  });
  await check('CAT-PREFIX-LOCK', 'prefix cannot change once assets exist', () =>
    rejects(admin.query(`update public.categories set code_prefix='GNX' where id=$1`, [cat.id])));

  const assets = (await su.query(`select * from public.assets where category_id=$1 order by asset_code`, [cat.id])).rows;
  await check('DEFAULT-RACE', 'parallel set_default_asset on different assets: no errors, exactly one default', async () => {
    const sess = await Promise.all(Array.from({ length: 6 }, () => connect('admin')));
    const jobs = [];
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 6; i++) jobs.push(rpc(sess[i], 'set_default_asset', [assets[1 + i].id]));
    }
    const out = await Promise.allSettled(jobs);
    await Promise.all(sess.map(s => s.end()));
    const errs = out.filter(o => o.status === 'rejected').map(o => o.reason.message);
    const n = Number((await one(su, `select count(*) n from public.assets where category_id=$1 and is_default`, [cat.id])).n);
    assert(n === 1, `${n} defaults`);
    assert(errs.length === 0, `${errs.length}/${jobs.length} calls failed, e.g. ${errs[0]}`);
    return `30 concurrent calls, 1 default`;
  });
  await check('DEFAULT-TRANSFER', 'deactivating the default transfers it to first active asset by code + timeline', async () => {
    const d = await one(su, `select * from public.assets where category_id=$1 and is_default`, [cat.id]);
    await rpc(admin, 'update_asset', [d.id, d.version, JSON.stringify({ status: 'inactive' }), '{}']);
    const nd = await one(su, `select asset_code from public.assets where category_id=$1 and is_default`, [cat.id]);
    const first = await one(su, `select asset_code from public.assets where category_id=$1 and status='active' order by asset_code limit 1`, [cat.id]);
    assert(nd && nd.asset_code === first.asset_code, `new default ${nd?.asset_code}, expected ${first.asset_code}`);
    const ev = await one(su, `select count(*) n from public.timeline_events where event_type='default_transferred'`);
    assert(Number(ev.n) >= 1, 'no default_transferred timeline event');
    return `default -> ${nd.asset_code}`;
  });
  await check('DEFAULT-CREATE-TIMELINE', 'creating a new default asset logs default_unset on the previous default', async () => {
    const prev = await one(su, `select id from public.assets where category_id=$1 and is_default`, [cat.id]);
    await rpc(admin, 'create_asset', [JSON.stringify({ category_id: cat.id, name: 'افتراضي جديد', is_default: true }), '{}']);
    const ev = await one(su, `select count(*) n from public.timeline_events where asset_id=$1 and event_type='default_unset'`, [prev.id]);
    assert(Number(ev.n) >= 1, 'previous default silently unset without timeline event');
    return 'logged';
  });
  await check('ASSET-CAT-CHANGE', 'changing an asset category is rejected explicitly', async () => {
    const other = await one(su, `insert into public.categories (name, code_prefix) values ('أخرى','OTH') returning id`);
    const a = await one(su, `select * from public.assets where id=$1`, [assets[2].id]);
    return rejects(rpc(admin, 'update_asset', [a.id, a.version, JSON.stringify({ category_id: other.id }), '{}']));
  });

  // ---------- 5. dynamic fields (5 types) ----------
  const tgt = assets[3];
  const vals = o => JSON.stringify(o);
  await check('FIELD-TYPES-OK', 'valid values for text/number/date/boolean/select are stored typed', async () => {
    const a = await one(su, `select * from public.assets where id=$1`, [tgt.id]);
    await rpc(admin, 'update_asset', [a.id, a.version, '{}', vals({ f_text: 'نص', f_num: '12.5', f_date: '2026-01-31', f_bool: true, f_sel: optA.id })]);
    const r = (await su.query(`select f.field_key, v.* from public.asset_field_values v join public.category_fields f on f.id=v.field_id where v.asset_id=$1`, [a.id])).rows;
    const m = Object.fromEntries(r.map(x => [x.field_key, x]));
    assert(m.f_text.value_text === 'نص' && Number(m.f_num.value_number) === 12.5 && m.f_bool.value_boolean === true && m.f_sel.value_option_id === optA.id, JSON.stringify(m));
    return '5 typed values stored';
  });
  for (const [k, bad, label] of [['f_num', 'abc', 'number=abc'], ['f_num', 'NaN', 'number=NaN'], ['f_num', 'Infinity', 'number=Infinity'],
    ['f_date', '2026-13-40', 'date=2026-13-40'], ['f_bool', 'maybe', 'boolean=maybe'], ['f_sel', optB.id, 'select=inactive option'], ['f_sel', '00000000-0000-4000-8000-0000000000ff', 'select=foreign id']]) {
    await check(`FIELD-INVALID ${label}`, `invalid ${label} rejected`, async () => {
      const a = await one(su, `select * from public.assets where id=$1`, [assets[4].id]);
      return rejects(rpc(admin, 'update_asset', [a.id, a.version, '{}', vals({ [k]: bad })]));
    });
  }
  await check('FIELD-CLEAR', 'sending an empty value clears a stored optional value', async () => {
    const a = await one(su, `select * from public.assets where id=$1`, [tgt.id]);
    await rpc(admin, 'update_asset', [a.id, a.version, '{}', vals({ f_text: '' })]);
    const r = await one(su, `select count(*) n from public.asset_field_values where asset_id=$1 and field_id=$2`, [a.id, fields.f_text.id]);
    assert(Number(r.n) === 0, 'old value still stored after clearing');
    return 'cleared';
  });
  await check('FIELD-TYPE-LOCK', 'type of a field with historical values cannot change', () =>
    rejects(admin.query(`update public.category_fields set field_type='text' where id=$1`, [fields.f_num.id])));
  await check('FIELD-DELETE-LOCK', 'field with values cannot be deleted (even by superuser)', () =>
    rejects(su.query(`delete from public.category_fields where id=$1`, [fields.f_num.id])));

  // ---------- 6. operation logs: last-record-only, dates, versions ----------
  const newAsset = async name => (await rpc(admin, 'create_asset', [JSON.stringify({ category_id: cat.id, name }), '{}'])).r;
  for (let i = 5; i <= 10; i++) assets[i] = await newAsset(`أصل سيناريو ${i}`);
  const A = assets[5];
  const fs = await rpc(admin, 'save_fuel_transaction', [JSON.stringify({ asset_id: A.id, fuel_type_id: fuel.id, transaction_date: day(10), transaction_type: 'supply', quantity: 100 })]);
  const L1 = (await rpc(operator, 'save_operation_log', [JSON.stringify({ asset_id: A.id, operation_date: day(5), previous_reading: 0, current_reading: 10, fuel_type_id: fuel.id, operator_id: operatorRow.id }), vals({ temp: 40 })])).r;
  const L2 = (await rpc(operator, 'save_operation_log', [JSON.stringify({ asset_id: A.id, operation_date: day(4), current_reading: 20, fuel_type_id: fuel.id }), vals({ temp: 41 })])).r;
  await check('OPLOG-CALC', 'usage/fuel computed by DB (10h x 2 L/h = 20 L)', async () => {
    assert(Number(L1.usage_value) === 10 && Number(L1.fuel_consumed) === 20, JSON.stringify({ u: L1.usage_value, f: L1.fuel_consumed }));
    assert(Number(L2.previous_reading) === 10, 'previous reading not carried over');
    return 'ok';
  });
  await check('OPLOG-REQ-FIELD', 'missing required operation field rejected', () =>
    rejects(rpc(operator, 'save_operation_log', [JSON.stringify({ asset_id: A.id, operation_date: day(3), current_reading: 25 }), '{}'])));
  await check('OPLOG-FUTURE', 'future date rejected', () =>
    rejects(rpc(operator, 'save_operation_log', [JSON.stringify({ asset_id: A.id, operation_date: day(-1), current_reading: 25 }), vals({ temp: 1 })])));
  await check('OPLOG-NOT-LATEST-EDIT', 'editing a non-latest log rejected', () =>
    rejects(rpc(operator, 'save_operation_log', [JSON.stringify({ id: L1.id, version: L1.version, operation_date: L1.operation_date, current_reading: 11 }), vals({ temp: 1 })])));
  await check('OPLOG-NOT-LATEST-DELETE', 'deleting a non-latest log rejected', () =>
    rejects(rpc(operator, 'delete_operation_log', [L1.id, L1.version])));
  await check('OPLOG-NOT-LATEST-SQL', 'non-latest log cannot be changed even by superuser SQL', () =>
    rejects(su.query(`update public.operation_logs set notes='x' where id=$1`, [L1.id])));
  await check('OPLOG-VERSION', 'stale version on latest log rejected; fresh version accepted', async () => {
    const ok = (await rpc(operator, 'save_operation_log', [JSON.stringify({ id: L2.id, version: L2.version, operation_date: L2.operation_date, current_reading: 22 }), vals({ temp: 42 })])).r;
    const m = await rejects(rpc(operator, 'save_operation_log', [JSON.stringify({ id: L2.id, version: L2.version, operation_date: L2.operation_date, current_reading: 23 }), vals({ temp: 43 })]), /تعارض/);
    return `v${L2.version}->v${ok.version}; ${m}`;
  });
  await check('OPLOG-VIEWER', 'viewer cannot save operation logs', () =>
    rejects(rpc(viewer, 'save_operation_log', [JSON.stringify({ asset_id: A.id, operation_date: day(2), current_reading: 30 }), vals({ temp: 1 })])));
  await check('OPLOG-SAME-DAY-RACE', 'two parallel logs for the same asset & day -> exactly one succeeds', async () => {
    const B = assets[6];
    await rpc(admin, 'save_fuel_transaction', [JSON.stringify({ asset_id: B.id, fuel_type_id: fuel.id, transaction_date: day(10), transaction_type: 'supply', quantity: 500 })]);
    const s = await Promise.all([connect('operator'), connect('operator'), connect('admin')]);
    const out = await Promise.allSettled(s.map((c, i) => rpc(c, 'save_operation_log', [JSON.stringify({ asset_id: B.id, operation_date: day(1), previous_reading: 0, current_reading: 5 + i, fuel_type_id: fuel.id }), vals({ temp: 1 })])));
    await Promise.all(s.map(c => c.end()));
    const okN = out.filter(o => o.status === 'fulfilled').length;
    assert(okN === 1, `${okN} succeeded`);
    return `1 of 3 succeeded`;
  });

  // ---------- 7. balances under concurrency ----------
  await check('FUEL-OVERDRAW', 'adjustment_minus beyond balance rejected', () =>
    rejects(rpc(admin, 'save_fuel_transaction', [JSON.stringify({ asset_id: A.id, fuel_type_id: fuel.id, transaction_date: today, transaction_type: 'adjustment_minus', quantity: 1000, adjustment_reason: 'اختبار' })])));
  await check('FUEL-PARALLEL-WITHDRAW', '2 parallel withdrawals of 60 from 100 -> one fails, balance >= 0', async () => {
    const C = assets[7];
    await rpc(admin, 'save_fuel_transaction', [JSON.stringify({ asset_id: C.id, fuel_type_id: fuel.id, transaction_date: day(3), transaction_type: 'supply', quantity: 100 })]);
    const s = await Promise.all([connect('admin'), connect('admin')]);
    const out = await Promise.allSettled(s.map(c => rpc(c, 'save_fuel_transaction', [JSON.stringify({ asset_id: C.id, fuel_type_id: fuel.id, transaction_date: today, transaction_type: 'adjustment_minus', quantity: 60, adjustment_reason: 'سحب' })])));
    await Promise.all(s.map(c => c.end()));
    const bal = Number((await one(su, `select balance from public.asset_fuel_balances where asset_id=$1 and fuel_type_id=$2`, [C.id, fuel.id])).balance);
    assert(bal >= 0, `balance ${bal}`);
    assert(out.filter(o => o.status === 'fulfilled').length === 1, 'both or none succeeded');
    return `balance ${bal}`;
  });
  await check('FUEL-DELETE-VS-CONSUME-RACE', 'delete of supply concurrent with consuming log cannot drive balance negative', async () => {
    const D = assets[8];
    const sup = (await rpc(admin, 'save_fuel_transaction', [JSON.stringify({ asset_id: D.id, fuel_type_id: fuel.id, transaction_date: day(9), transaction_type: 'supply', quantity: 100 })])).r;
    const s1 = await connect('operator');
    const s2 = await connect('admin');
    await s1.query('begin');
    await rpc(s1, 'save_operation_log', [JSON.stringify({ asset_id: D.id, operation_date: day(2), previous_reading: 0, current_reading: 40, fuel_type_id: fuel.id }), vals({ temp: 1 })]); // consumes 80, tx open
    const del = rpc(s2, 'delete_fuel_transaction', [sup.id, sup.version]).then(() => 'deleted', e => 'rejected: ' + e.message.slice(0, 90));
    await new Promise(r => setTimeout(r, 400));
    await s1.query('commit');
    const delRes = await del;
    await s1.end(); await s2.end();
    const bal = Number((await one(su, `select coalesce(sum(balance),0) b from public.asset_fuel_balances where asset_id=$1`, [D.id])).b);
    assert(bal >= 0, `NEGATIVE fuel balance ${bal} (delete: ${delRes})`);
    return `balance ${bal}; delete ${delRes}`;
  });
  await check('CHL-FLOW', 'chlorine supply then consumption through operation log updates balance', async () => {
    const E = assets[10];
    await rpc(admin, 'save_chlorine_transaction', [JSON.stringify({ asset_id: E.id, transaction_date: day(6), transaction_type: 'receipt', quantity: 10 })]);
    await rpc(operator, 'save_operation_log', [JSON.stringify({ asset_id: E.id, operation_date: day(2), previous_reading: 0, current_reading: 0, chlorine_consumed: 4, fuel_type_id: fuel.id }), vals({ temp: 1 })]);
    const b = Number((await one(su, `select balance from public.asset_chlorine_balances where asset_id=$1`, [E.id])).balance);
    assert(b === 6, `balance ${b}, expected 6`);
    return 'balance 6';
  });
  await check('CHL-NEGATIVE', 'chlorine consumption without stock rejected', () =>
    rejects(rpc(operator, 'save_operation_log', [JSON.stringify({ asset_id: assets[9].id, operation_date: day(2), previous_reading: 0, current_reading: 0, chlorine_consumed: 5 }), vals({ temp: 1 })])));
  await check('BAL-INVARIANT-GLOBAL', 'no negative fuel/chlorine balance anywhere', async () => {
    const f = await one(su, `select count(*) n from public.asset_fuel_balances where balance < 0`);
    const c = await one(su, `select count(*) n from public.asset_chlorine_balances where balance < 0`);
    assert(Number(f.n) + Number(c.n) === 0, `${f.n} fuel, ${c.n} chlorine negative balances`);
    return 'none';
  });

  // ---------- 8. audit immutability ----------
  await check('AUDIT-ADMIN-ONLY', 'operator/viewer read 0 audit rows; admin reads them', async () => {
    const o = Number((await one(operator, 'select count(*) n from public.audit_logs')).n);
    const v = Number((await one(viewer, 'select count(*) n from public.audit_logs')).n);
    const a = Number((await one(admin, 'select count(*) n from public.audit_logs')).n);
    assert(o === 0 && v === 0 && a > 0, `operator=${o} viewer=${v} admin=${a}`);
    return `admin=${a}`;
  });
  await check('AUDIT-IMMUTABLE-ADMIN', 'admin cannot update audit_logs', () => rejects(admin.query(`update public.audit_logs set reason='x'`)));
  await check('AUDIT-IMMUTABLE-SU', 'audit_logs immutable even for table owner (UPDATE/DELETE)', async () => {
    await rejects(su.query(`update public.audit_logs set reason='tamper'`));
    return rejects(su.query(`delete from public.audit_logs`));
  });
  await check('TIMELINE-APPEND-ONLY', 'timeline_events cannot be edited', () => rejects(su.query(`update public.timeline_events set title='x'`)));

  // ---------- 9. search ----------
  await check('SEARCH-CODE', 'search by asset code', async () => {
    const r = await viewer.query(`select * from public.global_search('GEN-0004')`);
    assert(r.rows.some(x => x.title.startsWith('GEN-0004')), JSON.stringify(r.rows.slice(0, 2)));
    return `${r.rowCount} hits`;
  });
  await check('SEARCH-OPTION-LABEL', 'search finds assets by select-option label', async () => {
    const r = await viewer.query(`select * from public.global_search('ألفا')`);
    assert(r.rows.some(x => x.entity_id === tgt.id), `${r.rowCount} hits, target missing`);
    return `${r.rowCount} hits`;
  });
  await check('SEARCH-WILDCARD', '"%" is a literal, not match-all; empty query returns nothing', async () => {
    const p = (await viewer.query(`select * from public.global_search('%')`)).rowCount;
    const e = (await viewer.query(`select * from public.global_search('')`)).rowCount;
    assert(p === 0 && e === 0, `'%' -> ${p} rows, '' -> ${e} rows`);
    return 'ok';
  });
  await check('SEARCH-RLS', 'inactive user gets no search results', async () => {
    const n = (await inactive.query(`select * from public.global_search('GEN')`)).rowCount;
    assert(n === 0, `${n} rows`);
    return '0';
  });

  // ---------- 10. backup / restore ----------
  const counts = async () => (await one(su, `select (select count(*) from public.assets) a, (select count(*) from public.operation_logs) l,
    (select count(*) from public.fuel_transactions) f, (select count(*) from public.asset_field_values) v, (select count(*) from public.timeline_events) t`));
  const backup = (await rpc(admin, 'export_aoms_backup', [])).r;
  await check('BACKUP-OPERATOR', 'operator cannot export/restore', async () => {
    await rejects(rpc(operator, 'export_aoms_backup', []));
    return rejects(rpc(operator, 'restore_aoms_backup', [JSON.stringify(backup)]));
  });
  await check('RESTORE-ROUNDTRIP', 'restore of own export succeeds and row counts match', async () => {
    const before = await counts();
    await rpc(admin, 'restore_aoms_backup', [JSON.stringify(backup)]);
    const after = await counts();
    const keys = ['a', 'l', 'f', 'v'];
    assert(keys.every(k => before[k] === after[k]), `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
    return JSON.stringify(after);
  });
  await check('RESTORE-ATOMIC-ROLLBACK', 'restore that would create a negative balance fails and leaves data untouched', async () => {
    const before = await counts();
    const bad = JSON.parse(JSON.stringify(backup));
    bad.fuel_transactions = bad.fuel_transactions.filter(t => t.transaction_type !== 'supply');
    const msg = await rejects(rpc(admin, 'restore_aoms_backup', [JSON.stringify(bad)]));
    const after = await counts();
    assert(JSON.stringify(before) === JSON.stringify(after), `data changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    return msg;
  });
  await check('RESTORE-ATOMIC-BADROW', 'restore with an invalid row (FK break) rolls back fully', async () => {
    const before = await counts();
    const bad = JSON.parse(JSON.stringify(backup));
    bad.operation_logs.push({ ...bad.operation_logs[0], id: '00000000-0000-4000-8000-00000000abcd', asset_id: '00000000-0000-4000-8000-00000000dead' });
    const msg = await rejects(rpc(admin, 'restore_aoms_backup', [JSON.stringify(bad)]));
    const after = await counts();
    assert(JSON.stringify(before) === JSON.stringify(after), 'data changed');
    return msg;
  });
  await check('RESTORE-FOREIGN-PROFILES', 'backup from another project (unknown author ids) restores', async () => {
    const other = JSON.parse(JSON.stringify(backup).replaceAll(U.admin, '00000000-0000-4000-8000-00000000beef').replaceAll(U.operator, '00000000-0000-4000-8000-00000000feed'));
    await rpc(admin, 'restore_aoms_backup', [JSON.stringify(other)]);
    return 'restored';
  });
  await check('RESTORE-MISSING-TABLE', 'backup missing a required table rejected', async () => {
    const bad = { ...backup }; delete bad.assets;
    return rejects(rpc(admin, 'restore_aoms_backup', [JSON.stringify(bad)]));
  });

  // ---------- 11. last admin ----------
  await check('AUTH-LAST-ADMIN', 'the last active admin cannot be demoted/deactivated', () =>
    rejects(admin.query(`update public.profiles set role='viewer' where id=$1`, [U.admin])));

  // ---------- 12. settings upsert (PostgREST upsert = INSERT .. ON CONFLICT DO UPDATE) / profile insert ----------
  const upsertSql = `insert into public.app_settings(key, value) values ($1, $2::jsonb)
                     on conflict (key) do update set value = excluded.value returning key, value, updated_by`;
  await check('SETTINGS-UPSERT-ADMIN', 'admin can upsert an app setting by key (stamped updated_by)', async () => {
    await admin.query(upsertSql, ['report_footer', JSON.stringify('أ')]);
    const r = (await admin.query(upsertSql, ['report_footer', JSON.stringify('ب')])).rows[0];
    assert(r && r.value === 'ب', `unexpected ${JSON.stringify(r)}`);
    assert(r.updated_by === U.admin, `updated_by=${r.updated_by}`);
    return 'upserted twice';
  });
  await check('SETTINGS-UPSERT-OPERATOR', 'operator cannot change app settings', () =>
    rejects(operator.query(upsertSql, ['report_footer', JSON.stringify('x')])));
  await check('PROFILE-INSERT-DENIED', 'profiles cannot be inserted directly (created by the auth trigger)', () =>
    rejects(admin.query(`insert into public.profiles(id, email, full_name, role, status) values (gen_random_uuid(), 'x@y.z', 'x', 'viewer', 'active')`)));

  for (const c of [admin, operator, viewer, inactive, anon, su]) await c.end();
  const pass = results.filter(r => r.ok).length;
  log(`\n# SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
