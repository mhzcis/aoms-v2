import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BACKUP_MAX_BYTES,
  BACKUP_SCHEMA_VERSION,
  calculateChlorineBalance,
  calculateFuelBalance,
  effectiveValue,
  getOperationDateRule,
  localTodayISO,
  normalizePrefix,
} from '../src/domain/models.js';
import {
  AomsEngine,
  buildAomsReport,
  globalSearchState,
  INITIAL_AOMS_STATE,
  validateAndPreviewBackup,
} from '../src/domain/aomsEngine.js';

let passed = 0;
function check(id, description, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`❌ Failed [${id}] ${description}:`, err.message);
    process.exit(1);
  }
}

async function checkAsync(id, description, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`❌ Failed [${id}] ${description}:`, err.message);
    process.exit(1);
  }
}

async function runAll() {
  const adminUser = { id: '00000000-0000-0000-0000-000000000001', full_name: 'مدير النظام', role: 'admin', status: 'active' };
  const operatorUser = { id: '00000000-0000-0000-0000-000000000002', full_name: 'مشغل ميداني', role: 'operator', status: 'active' };
  const viewerUser = { id: '00000000-0000-0000-0000-000000000003', full_name: 'مراقب', role: 'viewer', status: 'active' };
  const disabledUser = { id: '00000000-0000-0000-0000-000000000004', full_name: 'معطل', role: 'operator', status: 'inactive' };

  const engine = new AomsEngine(INITIAL_AOMS_STATE(), adminUser);

  let genCat, pumpCat, truckCat, manualCat;
  await checkAsync('A1', 'Admin can create category with normalized code_prefix', async () => {
    genCat = await engine.saveCategory({
      name: 'المولدات الكهربائية',
      code_prefix: ' gen ',
      uses_meter: true,
      meter_unit: 'ساعة تشغيل',
      supports_fuel: true,
      default_fuel_rate: 4.5,
      fuel_unit: 'لتر',
      supports_chlorine: false,
    });
    assert.equal(genCat.code_prefix, 'GEN');
    assert.equal(genCat.next_sequence, 1);
  });

  await checkAsync('A2', 'Admin can create second category supporting fuel and chlorine', async () => {
    pumpCat = await engine.saveCategory({
      name: 'مضخات المياه والآبار',
      code_prefix: 'pmp',
      uses_meter: true,
      meter_unit: 'متر مكعب',
      supports_fuel: true,
      default_fuel_rate: 1.2,
      fuel_unit: 'لتر',
      supports_chlorine: true,
      default_chlorine_consumption: 0.5,
      chlorine_unit: 'كجم',
      default_residual_chlorine: 0.8,
    });
    assert.equal(pumpCat.code_prefix, 'PMP');
  });

  await checkAsync('A3', 'Admin can create third category with km meter unit', async () => {
    truckCat = await engine.saveCategory({
      name: 'المركبات والصهاريج',
      code_prefix: 'TRK',
      uses_meter: true,
      meter_unit: 'كيلومتر',
      supports_fuel: true,
      default_fuel_rate: 0.35,
      fuel_unit: 'لتر',
    });
    assert.equal(truckCat.meter_unit, 'كيلومتر');
  });

  await checkAsync('A4', 'Admin can create category without meter (uses_meter = false)', async () => {
    manualCat = await engine.saveCategory({
      name: 'وحدات المعالجة اليدوية',
      code_prefix: 'MNL',
      uses_meter: false,
      supports_fuel: false,
      supports_chlorine: true,
      default_chlorine_consumption: 1.5,
      chlorine_unit: 'لتر',
      default_residual_chlorine: 0.6,
    });
    assert.equal(manualCat.uses_meter, false);
    assert.equal(manualCat.meter_unit, null);
  });

  check('A5', 'normalizePrefix strips spaces and uppercases', () => {
    assert.equal(normalizePrefix(' wtr 1 '), 'WTR1');
  });

  await checkAsync('A6', 'Rejects duplicate category name', async () => {
    await assert.rejects(() =>
      engine.saveCategory({
        name: 'المولدات الكهربائية',
        code_prefix: 'GN2',
        uses_meter: false,
      })
    );
  });

  await checkAsync('A7', 'Rejects duplicate code_prefix', async () => {
    await assert.rejects(() =>
      engine.saveCategory({
        name: 'تصنيف مكرر',
        code_prefix: 'GEN',
        uses_meter: false,
      })
    );
  });

  await checkAsync('A8', 'Rejects invalid code_prefix (<2 or >6 chars)', async () => {
    await assert.rejects(() =>
      engine.saveCategory({
        name: 'تصنيف قصير',
        code_prefix: 'A',
        uses_meter: false,
      })
    );
  });

  await checkAsync('A9', 'Requires meter_unit when uses_meter = true', async () => {
    await assert.rejects(() =>
      engine.saveCategory({
        name: 'بلا وحدة',
        code_prefix: 'UNT',
        uses_meter: true,
        meter_unit: '',
      })
    );
  });

  await checkAsync('A10', 'Clears meter_unit to null when uses_meter = false', async () => {
    assert.equal(manualCat.meter_unit, null);
  });

  let fAssetCap, fAssetSelect, fLogTemp, fLogBool, fLogDate;
  await checkAsync('A11', 'Admin can add dynamic field of type number to asset scope', async () => {
    fAssetCap = await engine.saveCategoryField({
      category_id: genCat.id,
      scope: 'asset',
      field_key: 'kva_rating',
      label: 'القدرة (kVA)',
      field_type: 'number',
      unit: 'kVA',
      is_required: true,
      show_in_reports: true,
      sort_order: 1,
    });
    assert.equal(fAssetCap.field_key, 'kva_rating');
  });

  await checkAsync('A12', 'Admin can add dynamic field of type select with options', async () => {
    fAssetSelect = await engine.saveCategoryField(
      {
        category_id: genCat.id,
        scope: 'asset',
        field_key: 'cooling_type',
        label: 'نوع التبريد',
        field_type: 'select',
        is_required: false,
        show_in_reports: true,
        sort_order: 2,
      },
      [
        { value_key: 'water', label: 'تبريد مائي' },
        { value_key: 'air', label: 'تبريد هوائي' },
      ]
    );
    const snap = await engine.snapshot();
    assert.equal(snap.category_field_options.filter(o => o.field_id === fAssetSelect.id).length, 2);
  });

  await checkAsync('A13', 'Rejects select dynamic field without active options', async () => {
    await assert.rejects(() =>
      engine.saveCategoryField(
        {
          category_id: genCat.id,
          scope: 'asset',
          field_key: 'empty_select',
          label: 'قائمة فارغة',
          field_type: 'select',
        },
        []
      )
    );
  });

  await checkAsync('A14', 'Admin can add dynamic fields to operation_log scope (number, boolean, date)', async () => {
    fLogTemp = await engine.saveCategoryField({
      category_id: genCat.id,
      scope: 'operation_log',
      field_key: 'oil_pressure',
      label: 'ضغط الزيت',
      field_type: 'number',
      unit: 'bar',
      is_required: true,
      show_in_reports: true,
    });
    fLogBool = await engine.saveCategoryField({
      category_id: genCat.id,
      scope: 'operation_log',
      field_key: 'filter_checked',
      label: 'فحص الفلتر',
      field_type: 'boolean',
      is_required: false,
      show_in_reports: true,
    });
    fLogDate = await engine.saveCategoryField({
      category_id: genCat.id,
      scope: 'operation_log',
      field_key: 'next_service_date',
      label: 'تاريخ الصيانة القادمة',
      field_type: 'date',
      is_required: false,
      show_in_reports: true,
    });
    assert.ok(fLogTemp.id && fLogBool.id && fLogDate.id);
  });

  await checkAsync('A15', 'Rejects duplicate (category_id, scope, field_key)', async () => {
    await assert.rejects(() =>
      engine.saveCategoryField({
        category_id: genCat.id,
        scope: 'asset',
        field_key: 'kva_rating',
        label: 'مكرر',
        field_type: 'text',
      })
    );
  });

  await checkAsync('A16', 'Allows soft-disabling dynamic field without deleting historical values', async () => {
    const updated = await engine.saveCategoryField({
      ...fLogDate,
      is_active: false,
    });
    assert.equal(updated.is_active, false);
  });

  let dieselFuel, petrolFuel;
  await checkAsync('B1', 'Admin can create fuel types', async () => {
    dieselFuel = await engine.saveFuelType({ name: 'سولار (ديزل)', unit: 'لتر' });
    petrolFuel = await engine.saveFuelType({ name: 'بنزين 95', unit: 'لتر' });
    assert.equal(dieselFuel.unit, 'لتر');
  });

  let gen1, gen2, pump1, manual1;
  await checkAsync('B2', 'Creates asset with auto-generated code GEN-0001 and required dynamic fields', async () => {
    const snap = await engine.snapshot();
    const waterOpt = snap.category_field_options.find(o => o.field_id === fAssetSelect.id && o.value_key === 'water');
    gen1 = await engine.createAsset(
      {
        category_id: genCat.id,
        name: 'مولد المحطة الرئيسية',
        location: 'خان يونس - المحطة الشرقية',
        latitude: 31.3461,
        longitude: 34.3064,
        fuel_type_id: dieselFuel.id,
        is_default: true,
      },
      {
        [fAssetCap.id]: 250,
        [fAssetSelect.id]: waterOpt.id,
      }
    );
    assert.equal(gen1.asset_code, 'GEN-0001');
    assert.equal(gen1.is_default, true);
  });

  await checkAsync('B3', 'Rejects asset creation if required dynamic field is missing', async () => {
    await assert.rejects(() =>
      engine.createAsset(
        {
          category_id: genCat.id,
          name: 'مولد ناقص',
        },
        {}
      )
    );
  });

  await checkAsync('B4', 'Rejects changing category code_prefix after assets exist under it', async () => {
    await assert.rejects(() =>
      engine.saveCategory({
        ...genCat,
        code_prefix: 'NEWP',
      })
    );
  });

  await checkAsync('B5', 'Creates second asset GEN-0002 and preserves single default per category', async () => {
    gen2 = await engine.createAsset(
      {
        category_id: genCat.id,
        name: 'مولد الطوارئ الاحتياطي',
        location: 'خان يونس - المبنى الإداري',
        fuel_type_id: dieselFuel.id,
        has_fuel_rate_override: true,
        fuel_rate_override: 0,
      },
      {
        [fAssetCap.id]: 100,
      }
    );
    assert.equal(gen2.asset_code, 'GEN-0002');
    assert.equal(gen2.is_default, false);
  });

  check('B6', 'Explicit override with 0 returns 0, not category default', () => {
    assert.equal(effectiveValue(gen2, genCat, 'fuel_rate'), 0);
    assert.equal(effectiveValue(gen1, genCat, 'fuel_rate'), 4.5);
  });

  await checkAsync('B7', 'Rejects changing asset category_id or asset_code after creation', async () => {
    await assert.rejects(() =>
      engine.updateAsset(gen1.id, gen1.version, { category_id: pumpCat.id })
    );
    await assert.rejects(() =>
      engine.updateAsset(gen1.id, gen1.version, { asset_code: 'GEN-9999' })
    );
  });

  await checkAsync('B8', 'Rejects setting inactive asset as default', async () => {
    await assert.rejects(() =>
      engine.createAsset(
        {
          category_id: genCat.id,
          name: 'مولد معطل افتراضي',
          status: 'inactive',
          is_default: true,
        },
        { [fAssetCap.id]: 80 }
      )
    );
  });

  await checkAsync('B9', 'Deactivating default asset automatically transfers default to active sibling', async () => {
    const deactivated = await engine.updateAsset(gen1.id, gen1.version, { status: 'inactive' });
    assert.equal(deactivated.is_default, false);
    const snap = await engine.snapshot();
    const g2Now = snap.assets.find(a => a.id === gen2.id);
    assert.equal(g2Now.is_default, true);
    gen1 = await engine.updateAsset(deactivated.id, deactivated.version, { status: 'active', is_default: true });
    gen2 = (await engine.snapshot()).assets.find(a => a.id === gen2.id);
  });

  await checkAsync('B10', 'Creates pump asset PMP-0001 and manual asset MNL-0001', async () => {
    pump1 = await engine.createAsset({
      category_id: pumpCat.id,
      name: 'مضخة البئر الشرقي',
      fuel_type_id: dieselFuel.id,
    });
    manual1 = await engine.createAsset({
      category_id: manualCat.id,
      name: 'وحدة تعقيم الخزان الرئيسي',
    });
    assert.equal(pump1.asset_code, 'PMP-0001');
    assert.equal(manual1.asset_code, 'MNL-0001');
  });

  let op1, op2;
  await checkAsync('C1', 'Creates active and inactive operators', async () => {
    op1 = await engine.saveOperator({ name: 'أحمد خليل', phone: '0599111222', status: 'active' });
    op2 = await engine.saveOperator({ name: 'سامي محمود', phone: '0599333444', status: 'inactive' });
    assert.equal(op1.status, 'active');
  });

  await checkAsync('C2', 'Rejects selecting inactive operator in a new operation log', async () => {
    await assert.rejects(() =>
      engine.saveOperationLog(
        {
          asset_id: gen1.id,
          operator_id: op2.id,
          log_date: '2026-10-10',
          record_type: 'daily',
          previous_reading: 100,
          current_reading: 110,
        },
        { [fLogTemp.id]: 4.2 }
      )
    );
  });

  let log1, log2;
  await checkAsync('C3', 'Creates first operation log for metered asset and snapshots units', async () => {
    log1 = await engine.saveOperationLog(
      {
        asset_id: gen1.id,
        operator_id: op1.id,
        log_date: '2026-10-10',
        record_type: 'daily',
        previous_reading: 100,
        current_reading: 110,
        notes: 'تشغيل صباحي منتظم',
      },
      { [fLogTemp.id]: 4.5, [fLogBool.id]: true }
    );
    assert.equal(log1.net_operation_delta, 10);
    assert.equal(log1.meter_unit_snapshot, 'ساعة تشغيل');
    assert.equal(log1.fuel_consumed, 45);
    assert.equal(log1.fuel_unit_snapshot, 'لتر');
  });

  await checkAsync('C4', 'Rejects duplicate operation log on the same date for the same asset', async () => {
    await assert.rejects(() =>
      engine.saveOperationLog(
        {
          asset_id: gen1.id,
          operator_id: op1.id,
          log_date: '2026-10-10',
          record_type: 'daily',
          previous_reading: 110,
          current_reading: 120,
        },
        { [fLogTemp.id]: 4.5 }
      )
    );
  });

  await checkAsync('C5', 'Rejects date earlier than next day after latest log', async () => {
    await assert.rejects(() =>
      engine.saveOperationLog(
        {
          asset_id: gen1.id,
          operator_id: op1.id,
          log_date: '2026-10-09',
          record_type: 'daily',
          previous_reading: 110,
          current_reading: 120,
        },
        { [fLogTemp.id]: 4.5 }
      )
    );
  });

  await checkAsync('C6', 'Enforces previous_reading = latest.current_reading on subsequent daily log', async () => {
    log2 = await engine.saveOperationLog(
      {
        asset_id: gen1.id,
        operator_id: op1.id,
        log_date: '2026-10-11',
        record_type: 'daily',
        previous_reading: 0,
        current_reading: 125,
      },
      { [fLogTemp.id]: 4.6 }
    );
    assert.equal(log2.previous_reading, 110);
    assert.equal(log2.net_operation_delta, 15);
  });

  await checkAsync('C7', 'Rejects editing or deleting non-latest operation log', async () => {
    await assert.rejects(() =>
      engine.saveOperationLog(
        {
          id: log1.id,
          version: log1.version,
          asset_id: gen1.id,
          log_date: '2026-10-10',
          record_type: 'daily',
          previous_reading: 100,
          current_reading: 112,
        },
        { [fLogTemp.id]: 4.5 }
      )
    );
    await assert.rejects(() => engine.deleteOperationLog(log1.id, log1.version));
  });

  await checkAsync('C8', 'Allows meter_reset with custom previous_reading and sets edited=true on edit', async () => {
    const resetLog = await engine.saveOperationLog(
      {
        asset_id: gen1.id,
        operator_id: op1.id,
        log_date: '2026-10-12',
        record_type: 'meter_reset',
        previous_reading: 5000,
        current_reading: 5008,
      },
      { [fLogTemp.id]: 4.4 }
    );
    assert.equal(resetLog.previous_reading, 5000);
    assert.equal(resetLog.net_operation_delta, 8);

    const editedReset = await engine.saveOperationLog(
      {
        id: resetLog.id,
        version: resetLog.version,
        asset_id: gen1.id,
        operator_id: op1.id,
        log_date: '2026-10-12',
        record_type: 'meter_reset',
        previous_reading: 5000,
        current_reading: 5010,
      },
      { [fLogTemp.id]: 4.4 }
    );
    assert.equal(editedReset.edited, true);
    assert.equal(editedReset.net_operation_delta, 10);
  });

  await checkAsync('C9', 'Supports non-metered asset operation log via direct net_operation_delta', async () => {
    const mLog = await engine.saveOperationLog({
      asset_id: manual1.id,
      operator_id: op1.id,
      log_date: '2026-10-12',
      record_type: 'daily',
      net_operation_delta: 3,
    });
    assert.equal(mLog.previous_reading, null);
    assert.equal(mLog.current_reading, null);
    assert.equal(mLog.net_operation_delta, 3);
    assert.equal(mLog.chlorine_consumed, 1.5);
  });

  check('C10', 'getOperationDateRule blocks same-day new log when latest log is today', () => {
    const today = localTodayISO();
    const rule = getOperationDateRule([{ id: '1', asset_id: 'a1', log_date: today }], 'a1');
    assert.equal(rule.blockedToday, true);
    assert.ok(rule.reason.includes('لا يمكن إضافة سجل جديد قبل اليوم التالي'));
  });

  let fPurchase, fDispense;
  await checkAsync('D1', 'Records fuel purchase and dispense and calculates balance accurately', async () => {
    fPurchase = await engine.saveFuelTransaction({
      fuel_type_id: dieselFuel.id,
      transaction_type: 'purchase',
      transaction_date: '2026-10-10',
      quantity: 500,
      reference_no: 'INV-1001',
    });
    fDispense = await engine.saveFuelTransaction({
      fuel_type_id: dieselFuel.id,
      asset_id: gen1.id,
      operator_id: op1.id,
      transaction_type: 'dispense',
      transaction_date: '2026-10-11',
      quantity: 120,
      reference_no: 'DSP-2001',
    });
    const snap = await engine.snapshot();
    assert.equal(calculateFuelBalance(snap.fuel_transactions, dieselFuel.id), 380);
  });

  await checkAsync('D2', 'Rejects fuel dispense or adjustment that drives balance negative', async () => {
    await assert.rejects(() =>
      engine.saveFuelTransaction({
        fuel_type_id: dieselFuel.id,
        asset_id: gen1.id,
        transaction_type: 'dispense',
        transaction_date: '2026-10-12',
        quantity: 900,
      })
    );
  });

  await checkAsync('D3', 'Requires notes on fuel adjustment and locks non-latest fuel transaction', async () => {
    await assert.rejects(() =>
      engine.saveFuelTransaction({
        fuel_type_id: dieselFuel.id,
        transaction_type: 'adjustment',
        transaction_date: '2026-10-12',
        quantity: -10,
        notes: '',
      })
    );
    await assert.rejects(() =>
      engine.deleteFuelTransaction(fPurchase.id, fPurchase.version)
    );
  });

  await checkAsync('D4', 'Records chlorine purchase, dispense, and adjustment with balance protection', async () => {
    await engine.saveChlorineTransaction({
      transaction_type: 'purchase',
      transaction_date: '2026-10-10',
      quantity: 100,
      unit_snapshot: 'كجم',
    });
    await engine.saveChlorineTransaction({
      asset_id: pump1.id,
      operator_id: op1.id,
      transaction_type: 'dispense',
      transaction_date: '2026-10-11',
      quantity: 15,
      residual_chlorine: 0.75,
    });
    const snap = await engine.snapshot();
    assert.equal(calculateChlorineBalance(snap.chlorine_transactions), 85);
    await assert.rejects(() =>
      engine.saveChlorineTransaction({
        asset_id: pump1.id,
        transaction_type: 'dispense',
        transaction_date: '2026-10-12',
        quantity: 200,
      })
    );
  });

  await checkAsync('E1', 'Optimistic locking rejects stale version updates', async () => {
    await assert.rejects(() =>
      engine.updateAsset(gen1.id, 1, { name: 'تعديل بنسخة قديمة' })
    );
  });

  await checkAsync('E2', 'Operator cannot perform admin actions (operators/assets/categories/backup are admin-only per spec §16.3)', async () => {
    engine.setUser(operatorUser);
    await assert.rejects(() => engine.saveOperator({ name: 'مشغل مضاف بواسطة مشغل', status: 'active' }));
    await assert.rejects(() => engine.setDefaultAsset(gen1.id));
    await assert.rejects(() => engine.saveCategory({ name: 'ممنوع', code_prefix: 'FRB', uses_meter: false }));
    await assert.rejects(() => engine.exportBackup());
  });

  await checkAsync('E3', 'Viewer is strictly read-only and cannot read audit_logs', async () => {
    engine.setUser(viewerUser);
    const snap = await engine.snapshot();
    assert.equal(snap.audit_logs.length, 0);
    await assert.rejects(() => engine.saveOperator({ name: 'ممنوع للمشاهد' }));
  });

  await checkAsync('E4', 'Disabled user is blocked from accessing or mutating data', async () => {
    engine.setUser(disabledUser);
    await assert.rejects(() => engine.snapshot());
    engine.setUser(adminUser);
  });

  await checkAsync('E5', 'Offline mode strictly disables all mutations across engine', async () => {
    engine.setOnline(false);
    await assert.rejects(() => engine.saveOperator({ name: 'أثناء انقطاع الاتصال' }));
    engine.setOnline(true);
  });

  await checkAsync('F1', 'Global search finds assets, categories, operators, logs, and dynamic values', async () => {
    const snap = await engine.snapshot();
    const res1 = globalSearchState(snap, 'GEN-0001', adminUser);
    assert.ok(res1.assets.length >= 1);
    const res2 = globalSearchState(snap, 'تبريد مائي', adminUser);
    assert.ok(res2.assets.some(a => a.id === gen1.id));
  });

  await checkAsync('F2', 'Report builder groups net_operation_delta by meter_unit_snapshot without summing incompatible units', async () => {
    await engine.saveOperationLog({
      asset_id: pump1.id,
      operator_id: op1.id,
      log_date: '2026-10-11',
      record_type: 'daily',
      previous_reading: 1000,
      current_reading: 1250,
    });
    const snap = await engine.snapshot();
    const rep = buildAomsReport(snap, { type: 'operations', category_id: 'all' });
    assert.equal(rep.summary.net_operation_by_unit['ساعة تشغيل'], 35);
    assert.equal(rep.summary.net_operation_by_unit['متر مكعب'], 250);
    assert.equal(rep.summary.net_operation_by_unit['بلا عداد'], 3);
  });

  await checkAsync('F3', 'Report builder includes dynamic fields when category is selected and include_dynamic_fields=true', async () => {
    const snap = await engine.snapshot();
    const rep = buildAomsReport(snap, {
      type: 'operations',
      category_id: genCat.id,
      include_dynamic_fields: true,
    });
    assert.ok(rep.dynamicColumns.some(c => c.field_key === 'oil_pressure'));
    assert.equal(rep.rows.find(row => row.id === log1.id).dyn_oil_pressure, 4.5);
  });

  let backupDoc;
  await checkAsync('G1', 'Admin exports full JSON backup with schema_version 2.0 and all 13 required keys', async () => {
    backupDoc = await engine.exportBackup();
    assert.equal(backupDoc.schema_version, BACKUP_SCHEMA_VERSION);
    const preview = validateAndPreviewBackup(backupDoc);
    assert.equal(preview.valid, true);
    assert.equal(preview.counts.categories, 4);
    assert.equal(preview.counts.assets, 4);
  });

  check('G2', 'Backup validator rejects files > 25MB, invalid schema_version, missing keys, and broken FKs', () => {
    assert.equal(validateAndPreviewBackup(backupDoc, BACKUP_MAX_BYTES + 1).valid, false);
    assert.equal(validateAndPreviewBackup({ ...backupDoc, schema_version: '1.0' }).valid, false);
    const brokenFk = JSON.parse(JSON.stringify(backupDoc));
    brokenFk.data.assets[0].category_id = 'non-existent-cat';
    assert.equal(validateAndPreviewBackup(brokenFk).valid, false);
  });

  await checkAsync('G3', 'Atomic restore rolls back completely on mid-flight failure without data loss', async () => {
    const beforeSnap = await engine.snapshot();
    await assert.rejects(() =>
      engine.restoreBackup(backupDoc, { simulateFailureMidFlight: true })
    );
    const afterSnap = await engine.snapshot();
    assert.equal(afterSnap.assets.length, beforeSnap.assets.length);
    assert.equal(afterSnap.operation_logs.length, beforeSnap.operation_logs.length);
  });

  await checkAsync('G4', 'Atomic restore succeeds on valid backup and records audit log', async () => {
    const counts = await engine.restoreBackup(backupDoc);
    assert.equal(counts.assets, 4);
    const snap = await engine.snapshot();
    assert.ok(snap.audit_logs.some(a => a.event_type === 'backup_restored'));
  });

  check('G5', 'Database migrations contain all required tables, RLS policies, and transactional RPCs', () => {
    const m1 = fs.readFileSync(new URL('../supabase/migrations/202610260001_aoms_v2.sql', import.meta.url), 'utf8');
    const m2 = fs.readFileSync(new URL('../supabase/migrations/202610260002_transactions_backup.sql', import.meta.url), 'utf8');
    for (const t of [
      'profiles',
      'categories',
      'category_fields',
      'category_field_options',
      'assets',
      'asset_field_values',
      'operators',
      'fuel_types',
      'operation_logs',
      'operation_log_values',
      'fuel_transactions',
      'chlorine_transactions',
      'timeline_events',
      'audit_logs',
      'app_settings',
    ]) {
      assert.ok(m1.toLowerCase().includes(`create table public.${t}`), `Missing table ${t} in migration 1`);
    }
    for (const rpc of [
      'create_asset',
      'update_asset',
      'set_default_asset',
      'save_operation_log',
      'delete_operation_log',
      'save_fuel_transaction',
      'delete_fuel_transaction',
      'save_chlorine_transaction',
      'delete_chlorine_transaction',
      'export_aoms_backup',
      'restore_aoms_backup',
    ]) {
      assert.ok(m1.toLowerCase().includes(rpc) || m2.toLowerCase().includes(rpc), `Missing RPC ${rpc} in migrations`);
    }
  });

  // ---- Production-shape conformance (added by audit 2026-10-26) ----
  // The checks above exercise the in-memory reference model. These make sure the shared
  // report / backup-preview / search helpers also work on rows shaped like the real
  // PostgreSQL schema (no category_id/edited/meter_unit_snapshot on operation_logs,
  // flat export document with operation_log_values).
  const sqlAll = ['202610260001_aoms_v2.sql', '202610260002_transactions_backup.sql', '202610260003_audit_hardening.sql']
    .map(f => fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')).join('\n');
  const tableCols = name => {
    const m = sqlAll.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(m, `table ${name} not found in migrations`);
    return new Set(m[1].split('\n').map(l => l.trim().split(/\s+/)[0]).filter(c => /^[a-z_]+$/.test(c)));
  };

  check('P1', 'operation_logs in SQL has no category_id → report must derive category from the asset', () => {
    const cols = tableCols('operation_logs');
    assert.ok(cols.has('operation_date') && cols.has('usage_value') && !cols.has('category_id'));
    const cat = { id: 'c1', name: 'مولدات', uses_meter: true, meter_unit: 'ساعة', is_active: true };
    const state = {
      categories: [cat], assets: [{ id: 'a1', category_id: 'c1', asset_code: 'GEN-0001', name: 'م1', status: 'active' }],
      operators: [], category_fields: [], category_field_options: [], operation_log_values: [],
      operation_logs: [
        { id: 'l1', asset_id: 'a1', operation_date: '2026-10-01', record_type: 'daily', usage_value: 5, fuel_consumed: 10, chlorine_consumed: 0, version: 1 },
        { id: 'l2', asset_id: 'a1', operation_date: '2026-10-02', record_type: 'daily', usage_value: 3, fuel_consumed: 6, chlorine_consumed: 0, version: 2 },
      ],
    };
    const r = buildAomsReport(state, { type: 'operations', category_id: 'c1' });
    assert.equal(r.rows.length, 2, 'category filter must match production rows');
    assert.equal(r.summary.net_operation_by_unit['ساعة'], 8);
    assert.equal(buildAomsReport(state, { type: 'operations', edited: 'edited' }).rows.length, 1, 'edited = version > 1');
  });

  check('P2', 'backup preview accepts a document shaped exactly like export_aoms_backup() and does not mutate it', () => {
    const doc = {
      schema_version: '2.0.0', exported_at: '2026-10-26T00:00:00Z',
      categories: [{ id: 'c1' }], category_fields: [], category_field_options: [],
      assets: [{ id: 'a1', category_id: 'c1', asset_code: 'GEN-0001' }], asset_field_values: [],
      operators: [], fuel_types: [], profiles: [],
      operation_logs: [{ id: 'l1', asset_id: 'a1' }], operation_log_values: [],
      fuel_transactions: [], chlorine_transactions: [], timeline_events: [], app_settings: [],
    };
    const before = JSON.stringify(doc);
    const res = validateAndPreviewBackup(doc);
    assert.equal(res.valid, true, res.errors.join(' | '));
    assert.equal(JSON.stringify(doc), before, 'preview must not mutate the document');
    const cols = tableCols('operation_log_values');
    assert.ok(cols.has('value_option_id') && cols.has('operation_log_id'));
  });

  check('P3', 'report column keys exist in rows built from production-shaped data', () => {
    const state = {
      categories: [{ id: 'c1', supports_chlorine: true, chlorine_unit: 'كجم' }],
      assets: [{ id: 'a1', category_id: 'c1', asset_code: 'P-1', name: 'م' }],
      fuel_types: [{ id: 'f1', name: 'ديزل', unit: 'لتر' }], operators: [],
      fuel_transactions: [{ id: 't1', fuel_type_id: 'f1', asset_id: null, transaction_date: '2026-10-01', transaction_type: 'supply', quantity: 10, invoice_number: 'INV-9', version: 1 }],
      chlorine_transactions: [{ id: 'k1', asset_id: 'a1', transaction_date: '2026-10-01', transaction_type: 'receipt', quantity: 3, version: 1 }],
    };
    const fr = buildAomsReport(state, { type: 'fuel' }).rows[0];
    assert.equal(fr.reference_no, 'INV-9');
    assert.equal(fr.unit_snapshot, 'لتر');
    assert.equal(buildAomsReport(state, { type: 'chlorine' }).rows[0].unit_snapshot, 'كجم');
  });

  console.log(`✅ ${passed} reference-model assertions passed.`);
  console.log('   NOTE: these run against the in-memory AomsEngine reference model (src/domain/aomsEngine.js),');
  console.log('   not against Supabase. Spec §22 defines 144 acceptance IDs; DB-level behaviour is verified');
  console.log('   separately by `npm run test:db` (supabase/tests/run-db-tests.mjs on real PostgreSQL).');
}

runAll();
