import { describe, expect, it } from 'vitest';
import {
  calcNetwork,
  calcPumpWater,
  calcTankConsumption,
  calculateTankBalance,
  getAssetTank,
  tankerLabel,
  validatePumpLog,
} from './models';
import { AomsEngine, INITIAL_AOMS_STATE } from './aomsEngine';

const admin = { id: 'admin-1', full_name: 'مدير النظام', role: 'admin', status: 'active' };
const daysAgo = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function setup() {
  const engine = new AomsEngine(INITIAL_AOMS_STATE(), admin);
  const diesel = await engine.saveFuelType({ name: 'سولار', unit: 'لتر' });
  const petrol = await engine.saveFuelType({ name: 'بنزين', unit: 'لتر' });
  const pumpCat = await engine.saveCategory({
    name: 'مضخات', code_prefix: 'PMP', uses_meter: true, meter_unit: 'ساعة تشغيل',
    supports_fuel: true, default_fuel_rate: 10, asset_kind: 'pump',
  });
  const tankerCat = await engine.saveCategory({ name: 'صهاريج', code_prefix: 'TRK', asset_kind: 'tanker' });
  const genCat = await engine.saveCategory({
    name: 'مولدات', code_prefix: 'GEN', uses_meter: true, meter_unit: 'ساعة تشغيل', supports_fuel: true, default_fuel_rate: 4,
  });
  const t1 = await engine.createAsset({ category_id: tankerCat.id, name: 'صهريج 1' });
  const t2 = await engine.createAsset({ category_id: tankerCat.id, name: 'صهريج 2' });
  return { engine, diesel, petrol, pumpCat, tankerCat, genCat, t1, t2 };
}

describe('خزان وقود واحد لكل أصل', () => {
  it('getAssetTank: أصل واحد = خزان واحد، و«بدون وقود» = لا خزان', () => {
    expect(getAssetTank({ id: 'a', fuel_type_id: 'ft1' })).toBe('ft1');
    expect(getAssetTank({ id: 'a', fuel_type_id: null })).toBeNull();
    expect(getAssetTank(null)).toBeNull();
  });

  it('رصيد الخزان = تزويد + تسوية موجبة − تسوية سالبة − استهلاك (أصل واحد فقط)', () => {
    const asset = { id: 'a1', fuel_type_id: 'd' };
    const txs = [
      { asset_id: 'a1', fuel_type_id: 'd', transaction_type: 'supply', quantity: 500 },
      { asset_id: 'a1', fuel_type_id: 'd', transaction_type: 'adjustment_plus', quantity: 20 },
      { asset_id: 'a1', fuel_type_id: 'd', transaction_type: 'adjustment_minus', quantity: 5 },
      { asset_id: 'a2', fuel_type_id: 'd', transaction_type: 'supply', quantity: 999 },
    ];
    const logs = [
      { asset_id: 'a1', fuel_type_id: 'd', fuel_consumed: 60 },
      { asset_id: 'a1', fuel_type_id: null, fuel_consumed: 24 },
      { asset_id: 'a2', fuel_type_id: 'd', fuel_consumed: 100 },
    ];
    expect(calculateTankBalance(asset, txs, logs)).toEqual({
      tank: 'd', supplied: 500, adjustedPlus: 20, adjustedMinus: 5, consumed: 84, balance: 431,
    });
    expect(calculateTankBalance({ id: 'a1', fuel_type_id: null }, txs, logs).balance).toBe(0);
  });

  it('الاستهلاك = ساعات التشغيل × استهلاك الساعة من بطاقة الأصل', () => {
    expect(calcTankConsumption(5, 12)).toBe(60);
    expect(calcTankConsumption(2.5, 3.3)).toBe(8.25);
    expect(calcTankConsumption(0, 12)).toBe(0);
    expect(calcTankConsumption(5, null)).toBe(0);
  });

  it('المحرك: التزويد بنوع وقود مختلف عن خزان الأصل مرفوض، وأصل «بدون وقود» لا يقبل تزويدًا', async () => {
    const { engine, diesel, petrol, genCat } = await setup();
    const g = await engine.createAsset({ category_id: genCat.id, name: 'مولد', fuel_type_id: diesel.id, has_fuel_rate_override: true, fuel_rate_override: 6 });
    const none = await engine.createAsset({ category_id: genCat.id, name: 'مولد بلا وقود', fuel_type_id: '' });
    expect(none.fuel_type_id).toBeNull();
    await engine.saveFuelTransaction({ asset_id: g.id, fuel_type_id: diesel.id, transaction_type: 'supply', transaction_date: daysAgo(5), quantity: 100 });
    await expect(
      engine.saveFuelTransaction({ asset_id: g.id, fuel_type_id: petrol.id, transaction_type: 'supply', transaction_date: daysAgo(5), quantity: 10 })
    ).rejects.toThrow(/خزان الأصل/);
    await expect(
      engine.saveFuelTransaction({ asset_id: none.id, fuel_type_id: diesel.id, transaction_type: 'supply', transaction_date: daysAgo(5), quantity: 10 })
    ).rejects.toThrow(/بلا خزان/);
    // consumption from hours × card rate (6 L/h)
    const log = await engine.saveOperationLog({ asset_id: g.id, operation_date: daysAgo(4), previous_reading: 100, current_reading: 105 });
    expect(log.fuel_consumed).toBe(30);
    expect(log.fuel_type_id).toBe(diesel.id);
    const s = await engine.snapshot();
    expect(calculateTankBalance(s.assets.find(a => a.id === g.id), s.fuel_transactions, s.operation_logs).balance).toBe(70);
    // the tank cannot switch fuel type after movements
    const cur = s.assets.find(a => a.id === g.id);
    await expect(engine.updateAsset(g.id, cur.version, { fuel_type_id: petrol.id })).rejects.toThrow(/نوع وقود الخزان/);
    // asset without a tank consumes nothing
    const l2 = await engine.saveOperationLog({ asset_id: none.id, operation_date: daysAgo(4), previous_reading: 0, current_reading: 9 });
    expect(l2.fuel_consumed).toBeNull();
  });
});

describe('المضخة: المياه والشبكة والصهريج', () => {
  it('المياه = (النهاية − البداية) × القدرة، والشبكة = الإجمالي − الموزع', () => {
    expect(calcPumpWater(1000, 1005, 80)).toBe(400);
    expect(calcPumpWater(10, 12.5, 30)).toBe(75);
    expect(calcPumpWater(10, 9, 30)).toBe(0);
    expect(calcPumpWater(10, 12, 0)).toBe(0);
    expect(calcNetwork(400, 30)).toBe(370);
    expect(calcNetwork(400, 0)).toBe(400);
  });

  it('الكمية الموزعة ≤ الإجمالي، والنقلات عدد صحيح، والصهريج إلزامي عند التوزيع', () => {
    expect(validatePumpLog({ waterTotal: 400, tripsCount: 3, distributed: 400, tankerId: 't' })).toEqual([]);
    expect(validatePumpLog({ waterTotal: 400, tripsCount: 3, distributed: 401, tankerId: 't' })[0]).toMatch(/تتجاوز/);
    expect(validatePumpLog({ waterTotal: 400, tripsCount: 1.5, distributed: 0, tankerId: 't' })[0]).toMatch(/النقلات/);
    expect(validatePumpLog({ waterTotal: 400, tripsCount: 2, distributed: 10, tankerId: null })[0]).toMatch(/الصهريج/);
    expect(tankerLabel({ name: 'صهريج مياه 1' })).toBe('صهريج: صهريج مياه 1');
  });

  it('المحرك: قدرة المضخة إلزامية > 0، ولقطة القدرة محفوظة في كل سجل ولا تتغير بتعديل البطاقة', async () => {
    const { engine, diesel, pumpCat, genCat, t1, t2 } = await setup();
    await expect(engine.createAsset({ category_id: pumpCat.id, name: 'مضخة', fuel_type_id: diesel.id })).rejects.toThrow(/قدرة المضخة/);
    await expect(engine.createAsset({ category_id: pumpCat.id, name: 'مضخة', pump_capacity: 0 })).rejects.toThrow(/قدرة المضخة/);
    const gen = await engine.createAsset({ category_id: genCat.id, name: 'ليس صهريجًا' });
    await expect(
      engine.createAsset({ category_id: pumpCat.id, name: 'مضخة', pump_capacity: 80, default_tanker_id: gen.id })
    ).rejects.toThrow(/صهريج/);
    const p = await engine.createAsset({ category_id: pumpCat.id, name: 'مضخة 1', fuel_type_id: diesel.id, pump_capacity: 80, default_tanker_id: t1.id });
    await engine.saveFuelTransaction({ asset_id: p.id, fuel_type_id: diesel.id, transaction_type: 'supply', transaction_date: daysAgo(10), quantity: 500 });

    const l1 = await engine.saveOperationLog({ asset_id: p.id, operation_date: daysAgo(6), previous_reading: 1000, current_reading: 1005 });
    expect(l1).toMatchObject({ pump_capacity_snapshot: 80, water_total: 400, tanker_id: t1.id, trips_count: 0, distributed_quantity: 0, network_quantity: 400, fuel_consumed: 50 });

    await expect(
      engine.saveOperationLog({ asset_id: p.id, operation_date: daysAgo(5), current_reading: 1007, tanker_id: t2.id, trips_count: 2, distributed_quantity: 161 })
    ).rejects.toThrow(/تتجاوز/);
    const l2 = await engine.saveOperationLog({ asset_id: p.id, operation_date: daysAgo(5), current_reading: 1007, tanker_id: t2.id, trips_count: 2, distributed_quantity: 60 });
    expect(l2).toMatchObject({ water_total: 160, tanker_id: t2.id, trips_count: 2, distributed_quantity: 60, network_quantity: 100 });

    // capacity change on the card does not rewrite history; edits keep the stored snapshot
    const cur = (await engine.snapshot()).assets.find(a => a.id === p.id);
    await engine.updateAsset(p.id, cur.version, { pump_capacity: 100 });
    const e = await engine.saveOperationLog({ id: l2.id, version: l2.version, asset_id: p.id, operation_date: daysAgo(5), current_reading: 1008 });
    expect(e).toMatchObject({ pump_capacity_snapshot: 80, water_total: 240, tanker_id: t2.id, distributed_quantity: 60, network_quantity: 180 });
    const l3 = await engine.saveOperationLog({ asset_id: p.id, operation_date: daysAgo(4), current_reading: 1009 });
    expect(l3).toMatchObject({ pump_capacity_snapshot: 100, water_total: 100, tanker_id: t1.id });
    const old = (await engine.snapshot()).operation_logs.find(l => l.id === l1.id);
    expect(old.pump_capacity_snapshot).toBe(80);
  });

  it('المحرك: لا يمكن تغيير نوع التصنيف بعد إضافة أصول له', async () => {
    const { engine, tankerCat } = await setup();
    await expect(engine.saveCategory({ ...tankerCat, asset_kind: 'general' })).rejects.toThrow(/نوع التصنيف/);
  });
});
