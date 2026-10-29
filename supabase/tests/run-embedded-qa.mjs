// PostgreSQL 17 (WASM), isolated in memory. Auth roles/functions are the same local
// Supabase stub used by native DB tests. This is NOT GoTrue, a network test, a
// multi-session concurrency test, or a substitute for the native PostgreSQL suite.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
let passed = 0;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS SQL-QA-${passed}: ${name}`); };
const reject = async fn => { let error; try { await fn(); } catch (e) { error = e; } assert.ok(error, 'Expected database rejection'); };
const rpc = async (name, ...args) => (await one(`select to_jsonb(x) as result from public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) x`, args.map(a => typeof a === 'object' ? JSON.stringify(a) : a))).result;
const U = { admin: '00000000-0000-4000-8000-000000000001', operator: '00000000-0000-4000-8000-000000000002', viewer: '00000000-0000-4000-8000-000000000003', inactive: '00000000-0000-4000-8000-000000000004' };
const as = async role => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: U[role], role: role === 'anon' ? 'anon' : 'authenticated' })]);
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`);
};

try {
  await db.exec(fs.readFileSync('supabase/tests/00_supabase_stub.sql', 'utf8'));
  for (const name of fs.readdirSync('supabase/migrations').sort()) {
    let sql = fs.readFileSync(`supabase/migrations/${name}`, 'utf8');
    // PGlite provides gen_random_uuid() natively, but not pgcrypto's extension
    // registration. No migration uses any other pgcrypto function. All DDL,
    // RLS policies, triggers and RPC bodies below execute without substitution.
    sql = sql.replace('create extension if not exists pgcrypto;', '');
    if (name.includes('0006_')) {
      await db.exec("insert into public.operators(name,phone) values('legacy invalid phone','NOT-A-PHONE')");
    }
    await db.exec(sql);
  }
  await check('all migrations apply and preserve the pre-existing invalid phone', async () => {
    assert.equal((await one("select count(*)::int n from public.operators where phone='NOT-A-PHONE'")).n, 1);
  });
  for (const [role, id] of Object.entries(U)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}@qa.invalid`]);
    await db.query('update public.profiles set role=$2,status=$3,full_name=$4 where id=$1', [id, role === 'inactive' ? 'operator' : role, role === 'inactive' ? 'inactive' : 'active', role]);
  }
  const today = (await one("select (now() at time zone 'Asia/Jerusalem')::date::text d")).d;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await as('admin');
  const cat = await one("insert into public.categories(name,code_prefix,uses_meter,meter_unit,supports_fuel,default_fuel_rate,supports_chlorine,chlorine_unit,asset_kind) values('QA pump','QAP',true,'ساعة تشغيل',true,12,true,'كجم','pump') returning *");
  const fuel = await one("insert into public.fuel_types(name,unit) values('QA fuel','لتر') returning *");
  const asset = await rpc('create_asset', { category_id: cat.id, name: 'QA pump', fuel_type_id: fuel.id, pump_capacity: 10 }, {});
  await check('admin creates an eligible pump and generated code', async () => assert.equal(asset.asset_code, 'QAP-0001'));
  await check('direct DB insert rejects invalid phone', async () => reject(() => one("insert into public.operators(name,phone) values('QA bad','NO-PHONE') returning *")));
  await check('a normal admin statement cannot spoof the trusted restore exception', async () => {
    await db.exec("select set_config('aoms.in_restore','true',false)");
    try { await reject(() => one("insert into public.operators(name,phone) values('QA spoof','NO-PHONE') returning *")); }
    finally { await db.exec("select set_config('aoms.in_restore','false',false)"); }
  });
  let operator;
  await check('DB normalises Arabic phone digits', async () => {
    operator = await one("insert into public.operators(name,phone) values('QA operator','٠٥٩١٢٣٤٥٦٧') returning *");
    assert.equal(operator.phone, '0591234567');
  });
  await check('optional blank phone remains valid', async () => { await one("insert into public.operators(name,phone) values('QA no phone','') returning *"); });
  await rpc('save_fuel_transaction', { asset_id: asset.id, fuel_type_id: fuel.id, transaction_date: yesterday, transaction_type: 'supply', quantity: 1000 });
  await rpc('save_chlorine_transaction', { asset_id: asset.id, transaction_date: yesterday, transaction_type: 'receipt', quantity: 500 });
  await as('operator');
  let log;
  await check('operator may save an operational reading through the SQL RPC', async () => {
    log = await rpc('save_operation_log', { asset_id: asset.id, operator_id: operator.id, operation_date: yesterday, previous_reading: 100, current_reading: 101, chlorine_consumed: 2 }, {});
    assert.equal(Number(log.fuel_consumed), 12); assert.equal(Number(log.water_total), 10);
  });
  await check('operator cannot create an asset', async () => reject(() => rpc('create_asset', { category_id: cat.id, name: 'forbidden', pump_capacity: 10 }, {})));
  await check('operator cannot restore the database', async () => reject(() => rpc('restore_aoms_backup', {})));
  await as('viewer');
  await check('viewer can read assets', async () => assert.equal((await one('select count(*)::int n from public.assets')).n, 1));
  await check('viewer cannot write an operation even through the direct RPC', async () => reject(() => rpc('save_operation_log', { asset_id: asset.id, operation_date: today, current_reading: 102 }, {})));
  await check('viewer cannot edit operator data', async () => {
    const result = await db.query("update public.operators set name='forbidden' where id=$1 returning *", [operator.id]); assert.equal(result.rows.length, 0);
  });
  await check('viewer cannot export the backup', async () => reject(() => rpc('export_aoms_backup')));
  await as('inactive');
  await check('inactive profile cannot read operational assets', async () => assert.equal((await one('select count(*)::int n from public.assets')).n, 0));
  await as('anon');
  await check('anonymous user cannot read operational assets', async () => {
    try { assert.equal((await one('select count(*)::int n from public.assets')).n, 0); }
    catch (e) { if (!/permission denied/.test(e.message)) throw e; }
  });
  await as('admin');
  await check('saved historical rate and water capacity survive asset edits', async () => {
    await rpc('update_asset', asset.id, asset.version, { ...asset, pump_capacity: 20, has_fuel_rate_override: true, fuel_rate_override: 20 }, {});
    const current = await one('select * from public.operation_logs where id=$1', [log.id]);
    assert.equal(Number(current.fuel_consumed), 12); assert.equal(Number(current.water_total), 10);
  });
  await check('fuel and chlorine balances match independently calculated totals', async () => {
    const r = await one('select * from public.asset_fuel_tanks where asset_id=$1', [asset.id]);
    assert.equal(Number(r.balance), 988);
    const c = await one('select (select sum(quantity) from public.chlorine_transactions where asset_id=$1) - (select sum(chlorine_consumed) from public.operation_logs where asset_id=$1) balance', [asset.id]);
    assert.equal(Number(c.balance), 498);
  });
  await check('canonical field scope operation saves in the real enum', async () => {
    await rpc('save_category_field', { category_id: cat.id, scope: 'operation', field_key: 'qa_number', label: 'QA number', field_type: 'number', show_in_reports: true }, []);
    assert.equal((await one("select count(*)::int n from public.category_fields where field_key='qa_number' and scope='operation'")).n, 1);
  });
  const backup = await rpc('export_aoms_backup');
  const countBefore = (await one('select count(*)::int n from public.operators')).n;
  await one("insert into public.operators(name) values('QA after backup') returning *");
  await check('invalid-reference restore fails without partially replacing current data', async () => {
    const invalid = structuredClone(backup); invalid.assets = [];
    await reject(() => rpc('restore_aoms_backup', invalid));
    assert.equal((await one('select count(*)::int n from public.assets')).n, 1);
    assert.equal((await one('select count(*)::int n from public.operators')).n, countBefore + 1);
  });
  await check('valid exported backup actually restores the disposable database', async () => {
    await rpc('restore_aoms_backup', backup);
    assert.equal((await one('select count(*)::int n from public.operators')).n, countBefore);
    assert.equal((await one('select count(*)::int n from public.operation_logs')).n, 1);
  });
  await as('admin');
  await check('asset rates are materialized and independent of category changes',async()=>{
    const a=await one('select * from public.assets where id=$1',[asset.id]);
    assert.equal(a.has_fuel_rate_override,true);assert.equal(Number(a.fuel_rate_override),20);
    await db.query('update public.categories set default_fuel_rate=99 where id=$1',[cat.id]);
    assert.equal(Number((await one('select fuel_rate_override from public.assets where id=$1',[asset.id])).fuel_rate_override),20);
  });
  await check('linked fuel unit cannot be changed by a direct table write',async()=>reject(()=>db.query("update public.fuel_types set unit='جالون' where id=$1",[fuel.id])));
  for(const role of ['operator','viewer','inactive','anon']) await check(`${role} cannot preview or invoke full reset`,async()=>{
    await as(role);await reject(()=>rpc('aoms_reset_preview'));await reject(()=>rpc('reset_aoms_data','مسح شامل','irrelevant'));
  });
  await as('admin');
  let reset=await rpc('aoms_reset_preview');
  await check('incorrect reset phrase leaves assets intact',async()=>{await reject(()=>rpc('reset_aoms_data','wrong',reset.fingerprint));assert.equal((await one('select count(*)::int n from public.assets')).n,1);});
  await check('stale reset fingerprint leaves newly changed data intact',async()=>{
    await one("insert into public.operators(name) values('QA changed after preview') returning *");
    await reject(()=>rpc('reset_aoms_data','مسح شامل',reset.fingerprint));assert.equal((await one('select count(*)::int n from public.assets')).n,1);
  });
  await check('reset is atomic if a later delete fails',async()=>{
    await db.exec('reset role');
    await db.exec("create function public.qa_reject_reset() returns trigger language plpgsql as $$begin raise exception 'QA forced error'; end$$; create trigger qa_reject_reset before delete on public.fuel_types for each row execute function public.qa_reject_reset();");
    await as('admin');reset=await rpc('aoms_reset_preview');await reject(()=>rpc('reset_aoms_data','مسح شامل',reset.fingerprint));
    assert.equal((await one('select count(*)::int n from public.assets')).n,1);assert.equal((await one('select count(*)::int n from public.operation_logs')).n,1);
    await db.exec('reset role');await db.exec('drop trigger qa_reject_reset on public.fuel_types; drop function public.qa_reject_reset()');await as('admin');
  });
  await check('successful reset clears business data and preserves accounts/settings/audit',async()=>{
    const profiles=(await one('select count(*)::int n from public.profiles')).n;
    const settings=(await one('select count(*)::int n from public.app_settings')).n;
    const audits=(await one('select count(*)::int n from public.audit_logs')).n;
    reset=await rpc('aoms_reset_preview');await rpc('reset_aoms_data','مسح شامل',reset.fingerprint);
    assert.equal((await one('select count(*)::int n from public.assets')).n,0);assert.equal((await one('select count(*)::int n from public.operation_logs')).n,0);
    assert.equal((await one('select count(*)::int n from public.profiles')).n,profiles);assert.equal((await one('select count(*)::int n from public.app_settings')).n,settings);
    assert.equal((await one('select count(*)::int n from public.audit_logs')).n,audits+1);assert.equal((await one("select count(*)::int n from public.timeline_events where event_type='application_reset'")).n,1);
  });
  await check('pre-reset backup restores after a complete reset',async()=>{await rpc('restore_aoms_backup',backup);assert.equal((await one('select count(*)::int n from public.assets')).n,1);assert.equal((await one('select count(*)::int n from public.operation_logs')).n,1);});
  console.log(JSON.stringify({ engine: 'PostgreSQL 17 WASM / PGlite', passed, production_data_used: false, auth: 'local Supabase SQL stub', concurrency: 'not tested by this suite' }));
} finally { await db.close(); }
