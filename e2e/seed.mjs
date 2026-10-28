// Seeds a migrated AOMS database with realistic demo data for the browser E2E run.
// Usage: PGURL=postgres://postgres@127.0.0.1:54329/aoms_e2e node e2e/seed.mjs
import pg from 'pg';

export const USERS = {
  admin: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@aoms.test', name: 'مدير النظام', role: 'admin' },
  operator: { id: '10000000-0000-4000-8000-000000000002', email: 'operator@aoms.test', name: 'مشغل ميداني', role: 'operator' },
  viewer: { id: '10000000-0000-4000-8000-000000000003', email: 'viewer@aoms.test', name: 'مراقب', role: 'viewer' },
};

async function main() {
  const su = new pg.Client({ connectionString: process.env.PGURL });
  await su.connect();
  for (const u of Object.values(USERS)) {
    await su.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3) on conflict (id) do nothing`,
      [u.id, u.email, JSON.stringify({ full_name: u.name })]);
    // profile is created by the on_auth_user_created_aoms trigger (viewer/inactive); activate it
    await su.query(`update public.profiles set role=$2, status='active', full_name=$3 where id=$1`, [u.id, u.role, u.name]);
  }
  const admin = new pg.Client({ connectionString: process.env.PGURL });
  await admin.connect();
  await admin.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.admin.id, role: 'authenticated' })]);
  await admin.query('set role authenticated');
  const one = async (sql, p = []) => (await admin.query(sql, p)).rows[0];
  const rpc = async (fn, args) => (await one(`select to_jsonb(x) r from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) x`, args)).r;
  const today = (await one(`select (now() at time zone 'Asia/Jerusalem')::date::text d`)).d;
  const day = n => new Date(Date.parse(today + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

  const fuel = await one(`insert into public.fuel_types (name, unit) values ('ديزل','لتر') returning *`);
  const gen = await one(`insert into public.categories (name, code_prefix, description, uses_meter, meter_unit, supports_fuel, default_fuel_rate, fuel_unit, supports_chlorine)
    values ('المولدات الكهربائية','GEN','مولدات الديزل',true,'ساعة تشغيل',true,4.5,'لتر',false) returning *`);
  const pump = await one(`insert into public.categories (name, code_prefix, uses_meter, meter_unit, supports_fuel, supports_chlorine, default_chlorine_consumption, chlorine_unit)
    values ('مضخات التعقيم','PMP',true,'ساعة تشغيل',false,true,0.5,'كجم') returning *`);
  // Migration 005: water pump (capacity m³/h + default tanker) and tanker categories.
  const wpump = await one(`insert into public.categories (name, code_prefix, uses_meter, meter_unit, supports_fuel, default_fuel_rate, fuel_unit, supports_chlorine, asset_kind)
    values ('مضخات المياه','WPM',true,'ساعة تشغيل',true,3,'لتر',false,'pump') returning *`);
  const tankerCat = await one(`insert into public.categories (name, code_prefix, uses_meter, meter_unit, supports_fuel, supports_chlorine, asset_kind)
    values ('الصهاريج','TRK',false,null,false,false,'tanker') returning *`);
  const F = {};
  await one('begin'); // FIELD-003 (migration 004): a select field and its options commit together
  for (const [key, label, type] of [['brand', 'الماركة', 'text'], ['kva', 'القدرة', 'number'], ['installed', 'تاريخ التركيب', 'date'], ['outdoor', 'خارجي', 'boolean'], ['cooling', 'نوع التبريد', 'select']]) {
    F[key] = await one(`insert into public.category_fields (category_id, scope, field_key, label, field_type, show_in_reports) values ($1,'asset',$2,$3,$4,true) returning *`, [gen.id, key, label, type]);
  }
  await one(`update public.category_fields set unit='kVA' where id=$1 returning id`, [F.kva.id]);
  const water = await one(`insert into public.category_field_options (field_id, value_key, label, sort_order) values ($1,'water','تبريد مائي',1) returning *`, [F.cooling.id]);
  await one(`insert into public.category_field_options (field_id, value_key, label, sort_order) values ($1,'air','تبريد هوائي',2) returning *`, [F.cooling.id]);
  await one('commit');
  await one(`insert into public.category_fields (category_id, scope, field_key, label, field_type, unit, show_in_reports) values ($1,'operation','oil_temp','حرارة الزيت','number','°C',true) returning *`, [gen.id]);
  const op1 = await one(`insert into public.operators (name, phone) values ('أحمد محمود','0599000001') returning *`);
  await one(`insert into public.operators (name, phone) values ('سامي خليل','0599000002') returning *`);

  const g1 = await rpc('create_asset', [JSON.stringify({ category_id: gen.id, name: 'مولد المحطة الرئيسية', location: 'المحطة 1', is_default: true, fuel_type_id: fuel.id }),
    JSON.stringify({ brand: 'Perkins', kva: '250', installed: '2024-03-01', outdoor: true, cooling: water.id })]);
  await rpc('create_asset', [JSON.stringify({ category_id: gen.id, name: 'مولد احتياطي', location: 'المحطة 2' }), JSON.stringify({ brand: 'Cummins', kva: '150' })]);
  const p1 = await rpc('create_asset', [JSON.stringify({ category_id: pump.id, name: 'مضخة الكلور 1', location: 'البئر 3', is_default: true }), '{}']);

  const t1 = await rpc('create_asset', [JSON.stringify({ category_id: tankerCat.id, name: 'صهريج 20 م³', location: 'الكراج' }), '{}']);
  const w1 = await rpc('create_asset', [JSON.stringify({ category_id: wpump.id, name: 'مضخة البئر الرئيسية', location: 'البئر 1', fuel_type_id: fuel.id, pump_capacity: 80, default_tanker_id: t1.id }), '{}']);
  await rpc('save_fuel_transaction', [JSON.stringify({ asset_id: w1.id, fuel_type_id: fuel.id, transaction_date: day(10), transaction_type: 'supply', quantity: 300, supplier: 'شركة الوقود' })]);
  await rpc('save_fuel_transaction', [JSON.stringify({ asset_id: g1.id, fuel_type_id: fuel.id, transaction_date: day(10), transaction_type: 'supply', quantity: 800, supplier: 'شركة الوقود', invoice_number: 'INV-1001' })]);
  await rpc('save_chlorine_transaction', [JSON.stringify({ asset_id: p1.id, transaction_date: day(10), transaction_type: 'receipt', quantity: 40, supplier: 'مورد الكلور' })]);
  let reading = 1000;
  for (let n = 6; n >= 1; n--) {
    const next = reading + 6 + (n % 3);
    await rpc('save_operation_log', [JSON.stringify({ asset_id: g1.id, operation_date: day(n), previous_reading: reading, current_reading: next, fuel_type_id: fuel.id, operator_id: op1.id, notes: `تشغيل يومي ${n}` }),
      JSON.stringify({ oil_temp: String(80 + n) })]);
    reading = next;
  }
  let pr = 200;
  for (let n = 3; n >= 1; n--) {
    await rpc('save_operation_log', [JSON.stringify({ asset_id: p1.id, operation_date: day(n), previous_reading: pr, current_reading: pr + 10, operator_id: op1.id }), '{}']);
    pr += 10;
  }
  let wr = 500;
  for (let n = 3; n >= 1; n--) {
    const hours = 4 + n;
    const total = hours * 80;
    await rpc('save_operation_log', [JSON.stringify({ asset_id: w1.id, operation_date: day(n), previous_reading: wr, current_reading: wr + hours, operator_id: op1.id,
      trips_count: n, distributed_quantity: Math.min(total, n * 20) }), '{}']);
    wr += hours;
  }
  const counts = (await su.query(`select 'assets' t, count(*) from public.assets union all select 'operation_logs', count(*) from public.operation_logs
    union all select 'fuel_transactions', count(*) from public.fuel_transactions union all select 'timeline_events', count(*) from public.timeline_events`)).rows;
  console.log('seeded', JSON.stringify(counts));
  await admin.end(); await su.end();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('SEED FAILED', e.message); process.exit(1); });
