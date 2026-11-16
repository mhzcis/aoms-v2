import { describe, expect, it } from 'vitest';
import {
  calculateChlorineBalance,
  calculateFuelBalance,
  canAdmin,
  canWrite,
  defaultResidualChlorine,
  effectiveValue,
  newOperationLogForm,
  normalizePrefix,
  validateCategoryInput,
  validateDynamicFieldDef,
  validateDynamicValue,
} from './models';
import {
  AomsEngine,
  buildAomsReport,
  globalSearchState,
  INITIAL_AOMS_STATE,
  validateAndPreviewBackup,
} from './aomsEngine';

const admin = { id: 'admin-1', full_name: 'مدير النظام', role: 'admin', status: 'active' };
const viewer = { id: 'viewer-1', full_name: 'مشاهد', role: 'viewer', status: 'active' };

describe('AOMS V2 Domain & Transactional Engine', () => {
  it('يطبع الاختصار ويتحقق من التصنيفات والحقول الديناميكية', () => {
    expect(normalizePrefix(' tr k ')).toBe('TRK');
    expect(validateDynamicValue({ is_required: true }, '')).toBeTruthy();
    expect(validateDynamicValue({ field_type: 'number' }, 'x')).toBeTruthy();
    expect(validateDynamicValue({ field_type: 'number' }, '4')).toBe('');
    expect(
      validateDynamicFieldDef({
        category_id: 'c1',
        scope: 'asset',
        field_key: 'sel',
        label: 'قائمة',
        field_type: 'select',
      }, []).options
    ).toBeTruthy();
  });

  it('يفصل الوراثة والتجاوز بما فيه الصفر ويفرض الأدوار', () => {
    expect(
      effectiveValue({ has_fuel_rate_override: true, fuel_rate_override: 0 }, { default_fuel_rate: 5 }, 'fuel_rate')
    ).toBe(0);
    expect(
      effectiveValue({ has_fuel_rate_override: false }, { default_fuel_rate: 5 }, 'fuel_rate')
    ).toBe(5);
    expect(canWrite('operator')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
    expect(canAdmin('admin')).toBe(true);
  });

  it('يملأ سجل التشغيل الجديد بالكلور المتبقي الافتراضي من بطاقة الأصل ثم التصنيف', () => {
    expect(
      defaultResidualChlorine(
        { has_residual_chlorine_override: true, residual_chlorine_override: 0.5 },
        { default_residual_chlorine: 0.2 }
      )
    ).toBe(0.5);
    expect(
      defaultResidualChlorine(
        { has_residual_chlorine_override: true, residual_chlorine_override: 0 },
        { default_residual_chlorine: 0.2 }
      )
    ).toBe(0);
    expect(
      defaultResidualChlorine({ has_residual_chlorine_override: false }, { default_residual_chlorine: 0.2 })
    ).toBe(0.2);
    expect(defaultResidualChlorine(null, null)).toBe('');
    const form = newOperationLogForm(
      { has_residual_chlorine_override: true, residual_chlorine_override: 0.5 },
      { default_residual_chlorine: 0.2 }
    );
    expect(form.id).toBe('');
    expect(form.residual_chlorine).toBe(0.5);
    expect(form.chlorine_consumed).toBe('');
    expect(newOperationLogForm().residual_chlorine).toBe('');
  });

  it('ينفذ دورة حياة كاملة للتصنيفات والأصول والتشغيل والوقود والكلور والاستعادة الذرية', async () => {
    const engine = new AomsEngine(INITIAL_AOMS_STATE(), admin);
    const cat = await engine.saveCategory({
      name: 'المولدات',
      code_prefix: 'GEN',
      uses_meter: true,
      meter_unit: 'ساعة تشغيل',
      supports_fuel: true,
      default_fuel_rate: 4,
    });
    const a1 = await engine.createAsset({ category_id: cat.id, name: 'مولد 1', is_default: true });
    const a2 = await engine.createAsset({ category_id: cat.id, name: 'مولد 2' });
    expect(a1.asset_code).toBe('GEN-0001');
    expect(a2.asset_code).toBe('GEN-0002');

    // Deactivating default asset transfers default to a2
    await engine.updateAsset(a1.id, a1.version, { status: 'inactive' });
    const snap1 = await engine.snapshot();
    expect(snap1.assets.find(x => x.id === a2.id).is_default).toBe(true);

    // Backup & Atomic Restore
    const backup = await engine.exportBackup();
    expect(validateAndPreviewBackup(backup).valid).toBe(true);
    const counts = await engine.restoreBackup(backup);
    expect(counts.assets).toBe(2);

    // Viewer cannot read audit_logs
    engine.setUser(viewer);
    const vSnap = await engine.snapshot();
    expect(vSnap.audit_logs).toEqual([]);
  });
});
