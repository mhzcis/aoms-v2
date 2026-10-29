import { assertOperation, assertTransaction } from '../utils/saveValidation';
import { normalizePhone, operatorErrors } from '../utils/operatorValidation';
import {
  normalizePrefix,
  validateCategoryInput,
  validateDynamicFieldDef,
  validateDynamicValue,
} from '../domain/models';
import {
  buildAomsReport,
  globalSearchState,
  validateAndPreviewBackup,
} from '../domain/aomsEngine';
import { AOMS_TABLES } from '../repositories/supabaseRepository';

const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine;

export class AomsService {
  constructor(repo) {
    this.repo = repo;
  }

  assertOnline() {
    if (!isBrowserOnline()) {
      throw new Error('غير متصل — وضع القراءة فقط');
    }
  }

  cachedSnapshot() {
    const cached = Object.fromEntries(AOMS_TABLES.map(t=>[t,this.repo.cached(t)]));
    const entries = AOMS_TABLES.map(t=>this.repo.cache?.get(t));
    cached.__snapshot = {cached:true,at:entries.filter(Boolean).map(x=>x.at).sort()[0]||null,failedTables:AOMS_TABLES.filter((_,i)=>!entries[i])};
    return cached;
  }
  async load() {
    try {
      if (!isBrowserOnline()) {
        return this.cachedSnapshot();
      }
      return await this.repo.snapshot();
    } catch (e) {
      if (!isBrowserOnline()) {
        return this.cachedSnapshot();
      }
      throw e;
    }
  }

  validateFields(fields = [], values = {}, options = []) {
    const errors = {};
    fields
      .filter(f => f.is_active)
      .forEach(f => {
        const val = values?.[f.id] !== undefined ? values[f.id] : values?.[f.field_key];
        const e = validateDynamicValue(f, val, options);
        if (e) errors[f.id] = e;
      });
    return errors;
  }

  async saveCategory(payload, currentCategories = [], currentAssets = []) {
    payload = {...payload};
    for (const key of ['fuel_unit','default_fuel_rate','default_chlorine_consumption','default_residual_chlorine']) delete payload[key];
    this.assertOnline();
    if (typeof this.repo.saveCategory === 'function') {
      return this.repo.saveCategory(payload);
    }
    const errors = validateCategoryInput(payload, currentCategories, currentAssets);
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
    const clean = {
      name: String(payload.name).trim(),
      code_prefix: normalizePrefix(payload.code_prefix),
      asset_kind: ['pump', 'tanker'].includes(payload.asset_kind) ? payload.asset_kind : 'general',
      description: payload.description || '',
      status: payload.status || 'active',
      uses_meter: Boolean(payload.uses_meter),
      meter_unit: payload.uses_meter ? payload.meter_unit : null,
      supports_fuel: Boolean(payload.supports_fuel),
      supports_chlorine: Boolean(payload.supports_chlorine),
      default_fuel_rate:
        payload.supports_fuel && payload.default_fuel_rate !== '' && payload.default_fuel_rate != null
          ? Number(payload.default_fuel_rate)
          : null,
      fuel_unit: payload.supports_fuel ? payload.fuel_unit || 'لتر' : null,
      default_chlorine_consumption:
        payload.supports_chlorine &&
        payload.default_chlorine_consumption !== '' &&
        payload.default_chlorine_consumption != null
          ? Number(payload.default_chlorine_consumption)
          : null,
      chlorine_unit: payload.supports_chlorine ? payload.chlorine_unit || 'كجم' : null,
      default_residual_chlorine:
        payload.supports_chlorine &&
        payload.default_residual_chlorine !== '' &&
        payload.default_residual_chlorine != null
          ? Number(payload.default_residual_chlorine)
          : null,
    };
    for (const key of ['fuel_unit','default_fuel_rate','default_chlorine_consumption','default_residual_chlorine']) delete clean[key];
    if (payload.id) {
      return this.repo.update('categories', payload.id, clean, payload.version);
    }
    return this.repo.create('categories', clean);
  }

  async saveCategoryField(fieldInput, optionsInput = [], existingFields = []) {
    fieldInput = { ...fieldInput, scope: fieldInput.scope === 'operation_log' ? 'operation' : fieldInput.scope };
    this.assertOnline();
    if (typeof this.repo.saveCategoryField === 'function') {
      return this.repo.saveCategoryField(fieldInput, optionsInput);
    }
    const errors = validateDynamicFieldDef(fieldInput, optionsInput, existingFields);
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
    const cleanKey = String(fieldInput.field_key)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    const cleanField = {
      category_id: fieldInput.category_id,
      scope: fieldInput.scope,
      field_key: cleanKey,
      label: String(fieldInput.label).trim(),
      description: fieldInput.description || '',
      field_type: fieldInput.field_type,
      unit: fieldInput.unit || '',
      is_required: Boolean(fieldInput.is_required),
      show_in_reports: fieldInput.show_in_reports !== false,
      sort_order: Number(fieldInput.sort_order ?? 0),
      is_active: fieldInput.is_active !== false,
    };
    const options =
      cleanField.field_type === 'select' && Array.isArray(optionsInput)
        ? optionsInput
            .map((opt, i) => ({ opt, i }))
            .filter(({ opt }) => opt && String(opt.label || '').trim())
            .map(({ opt, i }) => ({
              ...(opt.id ? { id: opt.id } : {}),
              value_key:
                String(opt.value_key || opt.label)
                  .trim()
                  .toLowerCase()
                  .replace(/\s+/g, '_') || `opt_${i + 1}`,
              label: String(opt.label).trim(),
              sort_order: Number(opt.sort_order ?? i),
              is_active: opt.is_active !== false,
            }))
        : [];
    // One RPC = one transaction: the field and its options are saved atomically, and the
    // database itself enforces FIELD-003 (migration 004) in addition to the check above.
    return this.repo.invoke('save_category_field', {
      p_field: { ...cleanField, ...(fieldInput.id ? { id: fieldInput.id } : {}) },
      p_options: options,
    });
  }

  createAsset(payload, values = {}) {
    this.assertOnline();
    if (typeof this.repo.createAsset === 'function') {
      return this.repo.createAsset(payload, values);
    }
    return this.repo.invoke('create_asset', { p_asset: payload, p_values: values });
  }

  updateAsset(id, version, payload, values = {}) {
    this.assertOnline();
    if (typeof this.repo.updateAsset === 'function') {
      return this.repo.updateAsset(id, version, payload, values);
    }
    return this.repo.invoke('update_asset', {
      p_id: id,
      p_version: version,
      p_asset: payload,
      p_values: values,
    });
  }

  setDefault(assetId) {
    this.assertOnline();
    if (typeof this.repo.setDefaultAsset === 'function') {
      return this.repo.setDefaultAsset(assetId);
    }
    return this.repo.invoke('set_default_asset', { p_asset_id: assetId });
  }

  async saveOperator(payload) {
    const errors = operatorErrors(payload);
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
    payload = { ...payload, phone: normalizePhone(payload.phone) };
    this.assertOnline();
    if (typeof this.repo.saveOperator === 'function') {
      return this.repo.saveOperator(payload);
    }
    const clean = {
      name: String(payload.name || '').trim(),
      phone: String(payload.phone || '').trim(),
      notes: String(payload.notes || '').trim(),
      status: payload.status || 'active',
    };
    if (!clean.name) throw new Error('اسم المشغل مطلوب');
    return payload.id
      ? this.repo.update('operators', payload.id, clean, payload.version)
      : this.repo.create('operators', clean);
  }

  async saveFuelType(payload) {
    this.assertOnline();
    if (typeof this.repo.saveFuelType === 'function') {
      return this.repo.saveFuelType(payload);
    }
    const clean = {
      name: String(payload.name || '').trim(),
      unit: String(payload.unit || 'لتر').trim(),
      status: payload.status || 'active',
    };
    if (!clean.name) throw new Error('اسم نوع الوقود مطلوب');
    return payload.id
      ? this.repo.update('fuel_types', payload.id, clean, payload.version)
      : this.repo.create('fuel_types', clean);
  }

  saveOperation(payload, values = {}) {
    this.assertOnline();
    assertOperation(payload);
    if (typeof this.repo.saveOperationLog === 'function') {
      return this.repo.saveOperationLog(payload, values);
    }
    return this.repo.invoke('save_operation_log', { p_log: payload, p_values: values });
  }

  deleteOperation(id, version) {
    this.assertOnline();
    if (typeof this.repo.deleteOperationLog === 'function') {
      return this.repo.deleteOperationLog(id, version);
    }
    return this.repo.invoke('delete_operation_log', { p_id: id, p_version: version });
  }

  saveFuel(payload) {
    this.assertOnline();
    assertTransaction(payload);
    if (typeof this.repo.saveFuelTransaction === 'function') {
      return this.repo.saveFuelTransaction(payload);
    }
    return this.repo.invoke('save_fuel_transaction', { p_transaction: payload });
  }

  deleteFuel(id, version) {
    this.assertOnline();
    if (typeof this.repo.deleteFuelTransaction === 'function') {
      return this.repo.deleteFuelTransaction(id, version);
    }
    return this.repo.invoke('delete_fuel_transaction', { p_id: id, p_version: version });
  }

  saveChlorine(payload) {
    this.assertOnline();
    assertTransaction(payload);
    if (typeof this.repo.saveChlorineTransaction === 'function') {
      return this.repo.saveChlorineTransaction(payload);
    }
    return this.repo.invoke('save_chlorine_transaction', { p_transaction: payload });
  }

  deleteChlorine(id, version) {
    this.assertOnline();
    if (typeof this.repo.deleteChlorineTransaction === 'function') {
      return this.repo.deleteChlorineTransaction(id, version);
    }
    return this.repo.invoke('delete_chlorine_transaction', { p_id: id, p_version: version });
  }

  async saveProfile(payload) {
    this.assertOnline();
    if (typeof this.repo.saveProfile === 'function') {
      return this.repo.saveProfile(payload);
    }
    const clean = {
      full_name: String(payload.full_name || '').trim(),
      role: payload.role || 'viewer',
      status: payload.status || 'active',
    };
    if (!payload.id) {
      // profiles.id references auth.users(id): a profile cannot exist without an auth user.
      // New users are invited through Supabase Auth; the on_auth_user_created_aoms trigger
      // creates their profile (viewer / inactive) and the admin activates it here.
      throw new Error('أنشئ المستخدم أولًا عبر دعوة Supabase Auth؛ يُنشأ ملفه تلقائيًا (مشاهد/معطّل) ثم فعّله وحدّد دوره من هنا');
    }
    return this.repo.update('profiles', payload.id, clean);
  }

  async saveSetting(key, value) {
    this.assertOnline();
    if (typeof this.repo.saveSetting === 'function') {
      return this.repo.saveSetting(key, value);
    }
    // app_settings is keyed by `key` (no id column): upsert on the primary key
    return this.repo.upsert('app_settings', { key, value }, 'key');
  }

  search(state, query, profile) {
    return globalSearchState(state, query, profile);
  }

  buildReport(state, filters) {
    return buildAomsReport(state, filters);
  }

  previewBackup(doc, rawByteLength = 0) {
    return validateAndPreviewBackup(doc, rawByteLength);
  }

  async previewReset() {
    this.assertOnline();
    return typeof this.repo.previewReset === 'function' ? this.repo.previewReset() : this.repo.invoke('aoms_reset_preview');
  }
  async resetData(confirmation,fingerprint) {
    this.assertOnline();
    if(confirmation !== 'مسح شامل' || !fingerprint) throw new Error('التأكيد ومعاينة البيانات مطلوبان');
    return typeof this.repo.resetData === 'function' ? this.repo.resetData(confirmation,fingerprint) : this.repo.invoke('reset_aoms_data',{p_confirmation:confirmation,p_expected_fingerprint:fingerprint});
  }
  async backup() {
    this.assertOnline();
    if (typeof this.repo.exportBackup === 'function') {
      return this.repo.exportBackup();
    }
    return this.repo.invoke('export_aoms_backup');
  }

  async restore(doc, options = {}) {
    this.assertOnline();
    if (typeof this.repo.restoreBackup === 'function') {
      return this.repo.restoreBackup(doc, options);
    }
    const check = validateAndPreviewBackup(doc, options.rawByteLength || 0);
    if (!check.valid) {
      throw new Error(`فشل التحقق من النسخة الاحتياطية: ${check.errors.join(' | ')}`);
    }
    return this.repo.invoke('restore_aoms_backup', { p_backup: doc });
  }
}
