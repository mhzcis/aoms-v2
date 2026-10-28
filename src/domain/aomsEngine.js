import {
  BACKUP_MAX_BYTES,
  BACKUP_SCHEMA_VERSION,
  calculateChlorineBalance,
  assetKind,
  NO_FUEL_LABEL,
  tankerLabel,
  calcNetwork,
  calcPumpWater,
  calculateFuelBalance,
  validatePumpLog,
  canAdmin,
  canWrite,
  CHLORINE_TX_TYPES,
  effectiveValue,
  formatAssetCode,
  FUEL_TX_TYPES,
  latestChlorineTransaction,
  latestFuelTransaction,
  latestOperationLog,
  localTodayISO,
  nextDateISO,
  normalizePrefix,
  previousOperationLog,
  roundNum,
  validateCategoryInput,
  validateDynamicFieldDef,
  validateDynamicValue,
} from './models.js';

const uuid = () =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

const VALID_FUEL_TYPES = new Set([
  ...Object.keys(FUEL_TX_TYPES),
  'purchase',
  'dispense',
  'adjustment',
]);

const VALID_CHLORINE_TYPES = new Set([
  ...Object.keys(CHLORINE_TX_TYPES),
  'purchase',
  'dispense',
  'adjustment',
]);

export const INITIAL_AOMS_STATE = () => ({
  profiles: [],
  categories: [],
  category_fields: [],
  category_field_options: [],
  assets: [],
  asset_field_values: [],
  operators: [],
  fuel_types: [],
  operation_logs: [],
  operation_log_field_values: [],
  operation_log_values: [],
  fuel_transactions: [],
  chlorine_transactions: [],
  timeline_events: [],
  audit_logs: [],
  app_settings: [
    { key: 'fuel_low_threshold', value: 100 },
    { key: 'chlorine_low_threshold', value: 20 },
  ],
});

const clone = x => JSON.parse(JSON.stringify(x));
const nowIso = () => new Date().toISOString();
const isOpScope = s => s === 'operation' || s === 'operation_log';

export class AomsEngine {
  constructor(initialState = INITIAL_AOMS_STATE(), currentUser = null) {
    this.state = {
      ...INITIAL_AOMS_STATE(),
      ...clone(initialState),
    };
    this.user = currentUser || {
      id: '00000000-0000-0000-0000-000000000001',
      full_name: 'مدير النظام',
      role: 'admin',
      status: 'active',
    };
    this.online = true;
    this.subscribers = new Set();
  }

  setUser(user) {
    this.user = user;
  }

  setOnline(flag) {
    this.online = Boolean(flag);
  }

  assertOnline() {
    if (!this.online) {
      throw new Error('غير متصل — وضع القراءة فقط');
    }
  }

  assertActiveUser() {
    if (!this.user || this.user.status !== 'active') {
      throw new Error('الحساب غير نشط أو غير مصرح له بالوصول');
    }
  }

  assertCanWrite() {
    this.assertOnline();
    this.assertActiveUser();
    if (!canWrite(this.user)) {
      throw new Error('صلاحية غير كافية: المشاهد في وضع القراءة فقط');
    }
  }

  assertCanAdmin() {
    this.assertOnline();
    this.assertActiveUser();
    if (!canAdmin(this.user)) {
      throw new Error('صلاحية غير كافية: هذه العملية مخصصة لمدير النظام فقط');
    }
  }

  notify() {
    for (const cb of this.subscribers) {
      try {
        cb(clone(this.state));
      } catch {
        // ignore listener errors
      }
    }
  }

  subscribe(cb) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  unsubscribe(unsub) {
    if (typeof unsub === 'function') unsub();
    else this.subscribers.delete(unsub);
  }

  async session() {
    if (!this.user || this.user.status !== 'active') return null;
    return { user: clone(this.user) };
  }

  async profile(id) {
    const found = this.state.profiles.find(p => p.id === id) || this.user;
    if (!found) throw new Error('الملف الشخصي غير موجود');
    return clone(found);
  }

  async snapshot() {
    this.assertActiveUser();
    const out = clone(this.state);
    if (!canAdmin(this.user)) {
      out.audit_logs = [];
    }
    return out;
  }

  cached(table) {
    if (table === 'audit_logs' && !canAdmin(this.user)) return [];
    return clone(this.state[table] || []);
  }

  recordAudit(eventType, entityType, entityId, beforeData, afterData, summary, timelineMeta = null) {
    const ts = nowIso();
    const beforeClone = beforeData ? clone(beforeData) : null;
    const afterClone = afterData ? clone(afterData) : null;
    this.state.audit_logs.unshift({
      id: uuid(),
      action: eventType,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId || null,
      actor_id: this.user?.id || null,
      before_json: beforeClone,
      after_json: afterClone,
      before_data: beforeClone,
      after_data: afterClone,
      created_at: ts,
    });
    const title = summary || `${eventType} (${entityType})`;
    this.state.timeline_events.unshift({
      id: uuid(),
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId || null,
      asset_id: timelineMeta?.asset_id || null,
      category_id: timelineMeta?.category_id || null,
      title,
      description: timelineMeta?.description || title,
      summary: title,
      details: timelineMeta?.details || null,
      created_at: ts,
      created_by: this.user?.id || null,
    });
  }

  checkVersion(currentRow, expectedVersion) {
    if (!currentRow) throw new Error('السجل غير موجود');
    if (
      expectedVersion !== undefined &&
      expectedVersion !== null &&
      Number(currentRow.version) !== Number(expectedVersion)
    ) {
      throw new Error(
        'تعارض في النسخة (Optimistic Locking): تم تعديل هذا السجل من مستخدم آخر، يرجى التحديث وإعادة المحاولة.'
      );
    }
  }

  async saveCategory(input) {
    this.assertCanAdmin();
    const errors = validateCategoryInput(input, this.state.categories, this.state.assets);
    if (Object.keys(errors).length) {
      throw new Error(Object.values(errors)[0]);
    }
    const prefix = normalizePrefix(input.code_prefix);
    const ts = nowIso();

    if (input.id) {
      const idx = this.state.categories.findIndex(c => c.id === input.id);
      const prev = this.state.categories[idx];
      this.checkVersion(prev, input.version);
      const nextKind = input.asset_kind !== undefined ? assetKind({ asset_kind: input.asset_kind }) : assetKind(prev);
      if (nextKind !== assetKind(prev) && this.state.assets.some(a => a.category_id === prev.id)) {
        throw new Error('لا يمكن تغيير نوع التصنيف (عام/مضخة/صهريج) بعد إضافة أصول له');
      }
      const updated = {
        ...prev,
        name: String(input.name).trim(),
        code_prefix: prefix,
        asset_kind: nextKind,
        description: input.description ?? prev.description ?? '',
        status: input.status || prev.status || 'active',
        uses_meter: Boolean(input.uses_meter),
        meter_unit: input.uses_meter ? input.meter_unit : null,
        supports_fuel: Boolean(input.supports_fuel),
        supports_chlorine: Boolean(input.supports_chlorine),
        default_fuel_rate:
          input.supports_fuel && input.default_fuel_rate !== '' && input.default_fuel_rate != null
            ? Number(input.default_fuel_rate)
            : null,
        fuel_unit: input.supports_fuel ? input.fuel_unit || 'لتر' : null,
        default_chlorine_consumption:
          input.supports_chlorine &&
          input.default_chlorine_consumption !== '' &&
          input.default_chlorine_consumption != null
            ? Number(input.default_chlorine_consumption)
            : null,
        chlorine_unit: input.supports_chlorine ? input.chlorine_unit || 'كجم' : null,
        default_residual_chlorine:
          input.supports_chlorine &&
          input.default_residual_chlorine !== '' &&
          input.default_residual_chlorine != null
            ? Number(input.default_residual_chlorine)
            : null,
        version: (prev.version || 1) + 1,
        updated_at: ts,
        updated_by: this.user.id,
      };
      this.state.categories[idx] = updated;
      this.recordAudit(
        'category_updated',
        'categories',
        updated.id,
        prev,
        updated,
        `تحديث تصنيف: ${updated.name}`,
        { category_id: updated.id }
      );
      this.notify();
      return clone(updated);
    }

    const created = {
      id: uuid(),
      name: String(input.name).trim(),
      code_prefix: prefix,
      asset_kind: assetKind({ asset_kind: input.asset_kind }),
      next_sequence: 1,
      description: input.description || '',
      status: input.status || 'active',
      uses_meter: Boolean(input.uses_meter),
      meter_unit: input.uses_meter ? input.meter_unit : null,
      supports_fuel: Boolean(input.supports_fuel),
      supports_chlorine: Boolean(input.supports_chlorine),
      default_fuel_rate:
        input.supports_fuel && input.default_fuel_rate !== '' && input.default_fuel_rate != null
          ? Number(input.default_fuel_rate)
          : null,
      fuel_unit: input.supports_fuel ? input.fuel_unit || 'لتر' : null,
      default_chlorine_consumption:
        input.supports_chlorine &&
        input.default_chlorine_consumption !== '' &&
        input.default_chlorine_consumption != null
          ? Number(input.default_chlorine_consumption)
          : null,
      chlorine_unit: input.supports_chlorine ? input.chlorine_unit || 'كجم' : null,
      default_residual_chlorine:
        input.supports_chlorine &&
        input.default_residual_chlorine !== '' &&
        input.default_residual_chlorine != null
          ? Number(input.default_residual_chlorine)
          : null,
      version: 1,
      created_at: ts,
      updated_at: ts,
      created_by: this.user.id,
      updated_by: this.user.id,
    };
    this.state.categories.push(created);
    this.recordAudit(
      'category_created',
      'categories',
      created.id,
      null,
      created,
      `إضافة تصنيف: ${created.name} (${created.code_prefix})`,
      { category_id: created.id }
    );
    this.notify();
    return clone(created);
  }

  async saveCategoryField(fieldInput, optionsInput = []) {
    this.assertCanAdmin();
    const errors = validateDynamicFieldDef(fieldInput, optionsInput, this.state.category_fields);
    if (Object.keys(errors).length) {
      throw new Error(Object.values(errors)[0]);
    }
    const ts = nowIso();
    const cleanKey = String(fieldInput.field_key)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    let savedField;
    if (fieldInput.id) {
      const idx = this.state.category_fields.findIndex(f => f.id === fieldInput.id);
      if (idx === -1) throw new Error('الحقل الديناميكي غير موجود');
      const prev = this.state.category_fields[idx];
      savedField = {
        ...prev,
        label: String(fieldInput.label).trim(),
        description: fieldInput.description ?? prev.description ?? '',
        unit: fieldInput.unit ?? prev.unit ?? '',
        is_required: Boolean(fieldInput.is_required),
        show_in_reports: fieldInput.show_in_reports !== false,
        sort_order: Number(fieldInput.sort_order ?? prev.sort_order ?? 0),
        is_active: fieldInput.is_active !== false,
        updated_at: ts,
      };
      this.state.category_fields[idx] = savedField;
    } else {
      savedField = {
        id: uuid(),
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
        created_at: ts,
        updated_at: ts,
      };
      this.state.category_fields.push(savedField);
    }

    if (savedField.field_type === 'select' && Array.isArray(optionsInput)) {
      optionsInput.forEach((opt, idx) => {
        if (!opt || !String(opt.label || '').trim()) return;
        const vKey =
          String(opt.value_key || opt.label)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_') || `opt_${idx + 1}`;
        const existingIdx = this.state.category_field_options.findIndex(
          o => o.field_id === savedField.id && (o.id === opt.id || o.value_key === vKey)
        );
        if (existingIdx >= 0) {
          this.state.category_field_options[existingIdx] = {
            ...this.state.category_field_options[existingIdx],
            label: String(opt.label).trim(),
            sort_order: Number(opt.sort_order ?? idx),
            is_active: opt.is_active !== false,
          };
        } else {
          this.state.category_field_options.push({
            id: uuid(),
            field_id: savedField.id,
            value_key: vKey,
            label: String(opt.label).trim(),
            sort_order: Number(opt.sort_order ?? idx),
            is_active: opt.is_active !== false,
          });
        }
      });
    }

    this.recordAudit(
      fieldInput.id ? 'category_field_updated' : 'category_field_created',
      'category_fields',
      savedField.id,
      null,
      savedField,
      `${fieldInput.id ? 'تحديث' : 'إضافة'} حقل ديناميكي: ${savedField.label}`,
      { category_id: savedField.category_id }
    );
    this.notify();
    return clone(savedField);
  }

  validateScopedDynamicValues(categoryId, scope, valuesMap = {}) {
    const fields = this.state.category_fields.filter(
      f =>
        f.category_id === categoryId &&
        (f.scope === scope || (isOpScope(f.scope) && isOpScope(scope))) &&
        f.is_active
    );
    const errors = {};
    for (const f of fields) {
      const val = valuesMap?.[f.id] !== undefined ? valuesMap[f.id] : valuesMap?.[f.field_key];
      const err = validateDynamicValue(f, val, this.state.category_field_options);
      if (err) errors[f.id] = err;
    }
    if (Object.keys(errors).length) {
      throw new Error(Object.values(errors)[0]);
    }
    return fields;
  }

  persistDynamicValues(table, ownerKey, ownerId, fields, valuesMap = {}) {
    this.state[table] = this.state[table].filter(v => v[ownerKey] !== ownerId);
    for (const f of fields) {
      const raw = valuesMap?.[f.id] !== undefined ? valuesMap[f.id] : valuesMap?.[f.field_key];
      if (raw === undefined || raw === null || raw === '') continue;
      const entry = {
        id: uuid(),
        [ownerKey]: ownerId,
        field_id: f.id,
        value_text: null,
        value_number: null,
        value_boolean: null,
        value_date: null,
        option_id: null,
        value_option_id: null,
      };
      if (f.field_type === 'text') entry.value_text = String(raw);
      else if (f.field_type === 'number') entry.value_number = Number(raw);
      else if (f.field_type === 'boolean') entry.value_boolean = raw === true || raw === 'true';
      else if (f.field_type === 'date') entry.value_date = String(raw);
      else if (f.field_type === 'select') {
        const opt = this.state.category_field_options.find(
          o => o.field_id === f.id && (o.id === raw || o.value_key === raw || o.label === raw)
        );
        if (opt) {
          entry.option_id = opt.id;
          entry.value_option_id = opt.id;
        }
      }
      this.state[table].push(entry);
    }
    if (table === 'operation_log_field_values') {
      this.state.operation_log_values = clone(this.state.operation_log_field_values);
    }
  }

  /**
   * Single fuel tank per asset + pump capacity + default tanker (mirrors migration 005).
   * Returns { fuel_type_id, pump_capacity, default_tanker_id } for the new/updated asset.
   */
  resolveTankAndPump(cat, payload, prev) {
    const kind = assetKind(cat);
    const has = k => payload[k] !== undefined;
    let fuelTypeId = has('fuel_type_id') ? payload.fuel_type_id || null : prev ? prev.fuel_type_id || null : null;
    if (!cat?.supports_fuel) fuelTypeId = prev ? prev.fuel_type_id || null : null;
    if (fuelTypeId && fuelTypeId !== (prev?.fuel_type_id || null)) {
      const ft = (this.state.fuel_types || []).find(f => f.id === fuelTypeId);
      if (!ft || ft.status !== 'active') throw new Error('نوع الوقود غير موجود أو غير نشط');
    }
    if (prev && (prev.fuel_type_id || null) !== fuelTypeId) {
      const used =
        (this.state.fuel_transactions || []).some(t => t.asset_id === prev.id && t.fuel_type_id !== fuelTypeId) ||
        (this.state.operation_logs || []).some(
          l => l.asset_id === prev.id && Number(l.fuel_consumed || 0) > 0 && (l.fuel_type_id || null) !== fuelTypeId
        );
      if (used) throw new Error('لا يمكن تغيير نوع وقود الخزان أو إزالته بعد تسجيل حركات أو استهلاك عليه');
    }
    let pumpCapacity = prev ? prev.pump_capacity ?? null : null;
    let defaultTanker = prev ? prev.default_tanker_id ?? null : null;
    if (kind === 'pump') {
      if (has('pump_capacity')) {
        pumpCapacity = payload.pump_capacity === '' || payload.pump_capacity == null ? null : Number(payload.pump_capacity);
      }
      if (has('default_tanker_id')) defaultTanker = payload.default_tanker_id || null;
      if (!prev || has('pump_capacity')) {
        if (!(Number(pumpCapacity) > 0)) throw new Error('قدرة المضخة (م³/ساعة) مطلوبة ويجب أن تكون أكبر من صفر');
      }
      if (defaultTanker && defaultTanker !== (prev?.default_tanker_id || null)) {
        const t = this.state.assets.find(a => a.id === defaultTanker);
        const tc = t && this.state.categories.find(c => c.id === t.category_id);
        if (!t || assetKind(tc) !== 'tanker' || t.status !== 'active' || t.id === prev?.id) {
          throw new Error('الصهريج الافتراضي يجب أن يكون أصلًا نشطًا من تصنيف صهاريج');
        }
      }
    }
    return { fuel_type_id: fuelTypeId, pump_capacity: pumpCapacity, default_tanker_id: defaultTanker };
  }

  async createAsset(payload, values = {}) {
    this.assertCanAdmin();
    const catIdx = this.state.categories.findIndex(c => c.id === payload.category_id);
    if (catIdx === -1) throw new Error('التصنيف غير موجود');
    const cat = this.state.categories[catIdx];
    if (cat.status !== 'active') {
      throw new Error('لا يمكن إضافة أصل تحت تصنيف غير نشط');
    }
    if (!String(payload.name || '').trim()) {
      throw new Error('اسم الأصل مطلوب');
    }
    if (payload.status === 'inactive' && payload.is_default) {
      throw new Error('لا يمكن تعيين أصل غير نشط كأصل افتراضي');
    }

    const tankFields = this.resolveTankAndPump(cat, payload, null);
    const activeFields = this.validateScopedDynamicValues(cat.id, 'asset', values);
    const seq = cat.next_sequence || 1;
    const code = formatAssetCode(cat.code_prefix, seq);
    this.state.categories[catIdx] = { ...cat, next_sequence: seq + 1 };

    const activeInCat = this.state.assets.filter(a => a.category_id === cat.id && a.status === 'active');
    const shouldBeDefault =
      payload.status === 'inactive' ? false : Boolean(payload.is_default) || activeInCat.length === 0;
    if (shouldBeDefault) {
      this.state.assets = this.state.assets.map(a =>
        a.category_id === cat.id ? { ...a, is_default: false } : a
      );
    }

    const ts = nowIso();
    const hasChlorineOv = Boolean(
      payload.has_chlorine_consumption_override ?? payload.has_chlorine_override
    );
    const chlorineOvVal =
      payload.chlorine_consumption_override ?? payload.chlorine_override ?? null;

    const asset = {
      id: uuid(),
      category_id: cat.id,
      asset_code: code,
      sequence_no: seq,
      name: String(payload.name).trim(),
      location: payload.location || '',
      latitude: payload.latitude !== '' && payload.latitude != null ? Number(payload.latitude) : null,
      longitude: payload.longitude !== '' && payload.longitude != null ? Number(payload.longitude) : null,
      status: payload.status || 'active',
      is_default: shouldBeDefault,
      ...tankFields,
      has_fuel_rate_override: Boolean(payload.has_fuel_rate_override),
      fuel_rate_override:
        payload.has_fuel_rate_override &&
        payload.fuel_rate_override !== '' &&
        payload.fuel_rate_override != null
          ? Number(payload.fuel_rate_override)
          : null,
      has_chlorine_override: hasChlorineOv,
      has_chlorine_consumption_override: hasChlorineOv,
      chlorine_consumption_override:
        hasChlorineOv && chlorineOvVal !== '' && chlorineOvVal != null
          ? Number(chlorineOvVal)
          : null,
      has_residual_chlorine_override: Boolean(payload.has_residual_chlorine_override),
      residual_chlorine_override:
        payload.has_residual_chlorine_override &&
        payload.residual_chlorine_override !== '' &&
        payload.residual_chlorine_override != null
          ? Number(payload.residual_chlorine_override)
          : null,
      notes: payload.notes || '',
      version: 1,
      created_at: ts,
      updated_at: ts,
      created_by: this.user.id,
      updated_by: this.user.id,
    };

    this.state.assets.push(asset);
    this.persistDynamicValues('asset_field_values', 'asset_id', asset.id, activeFields, values);
    this.recordAudit(
      'asset_created',
      'assets',
      asset.id,
      null,
      asset,
      `إضافة أصل: ${asset.asset_code} — ${asset.name}`,
      {
        asset_id: asset.id,
        category_id: asset.category_id,
      }
    );
    this.notify();
    return clone(asset);
  }

  async updateAsset(id, version, payload, values = null) {
    this.assertCanAdmin();
    const idx = this.state.assets.findIndex(a => a.id === id);
    const prev = this.state.assets[idx];
    this.checkVersion(prev, version);

    if (payload.category_id && payload.category_id !== prev.category_id) {
      throw new Error('لا يُسمح بتغيير تصنيف الأصل بعد إنشائه');
    }
    if (payload.asset_code && payload.asset_code !== prev.asset_code) {
      throw new Error('رمز الأصل ثابت ولا يمكن تعديله بعد الإنشاء');
    }

    const prevCat = this.state.categories.find(c => c.id === prev.category_id);
    const tankFields = this.resolveTankAndPump(prevCat, payload, prev);
    const nextStatus = payload.status || prev.status;
    let nextDefault = payload.is_default !== undefined ? Boolean(payload.is_default) : prev.is_default;
    if (nextStatus === 'inactive') {
      if (payload.is_default === true) {
        throw new Error('لا يمكن تعيين أصل غير نشط كأصل افتراضي');
      }
      nextDefault = false;
    }

    if (values !== null) {
      const activeFields = this.validateScopedDynamicValues(prev.category_id, 'asset', values);
      this.persistDynamicValues('asset_field_values', 'asset_id', prev.id, activeFields, values);
    }

    if (nextDefault) {
      this.state.assets = this.state.assets.map(a =>
        a.category_id === prev.category_id && a.id !== prev.id ? { ...a, is_default: false } : a
      );
    }

    const ts = nowIso();
    const updated = {
      ...prev,
      name: payload.name !== undefined ? String(payload.name).trim() : prev.name,
      location: payload.location !== undefined ? payload.location : prev.location,
      latitude:
        payload.latitude !== undefined
          ? payload.latitude === '' || payload.latitude === null
            ? null
            : Number(payload.latitude)
          : prev.latitude,
      longitude:
        payload.longitude !== undefined
          ? payload.longitude === '' || payload.longitude === null
            ? null
            : Number(payload.longitude)
          : prev.longitude,
      status: nextStatus,
      is_default: nextDefault,
      ...tankFields,
      has_fuel_rate_override:
        payload.has_fuel_rate_override !== undefined
          ? Boolean(payload.has_fuel_rate_override)
          : prev.has_fuel_rate_override,
      fuel_rate_override:
        payload.has_fuel_rate_override !== undefined
          ? payload.has_fuel_rate_override &&
            payload.fuel_rate_override !== '' &&
            payload.fuel_rate_override != null
            ? Number(payload.fuel_rate_override)
            : null
          : prev.fuel_rate_override,
      notes: payload.notes !== undefined ? payload.notes : prev.notes,
      version: (prev.version || 1) + 1,
      updated_at: ts,
      updated_by: this.user.id,
    };
    this.state.assets[idx] = updated;

    if (prev.is_default && !updated.is_default) {
      const replacement = this.state.assets.find(
        a => a.category_id === prev.category_id && a.status === 'active' && a.id !== prev.id
      );
      if (replacement) {
        replacement.is_default = true;
      }
    }

    this.recordAudit('asset_updated', 'assets', updated.id, prev, updated, `تحديث أصل: ${updated.asset_code}`, {
      asset_id: updated.id,
      category_id: updated.category_id,
    });
    this.notify();
    return clone(updated);
  }

  async setDefaultAsset(assetId) {
    this.assertCanAdmin();
    const target = this.state.assets.find(a => a.id === assetId);
    if (!target) throw new Error('الأصل غير موجود');
    if (target.status !== 'active') {
      throw new Error('لا يمكن تعيين أصل غير نشط كأصل افتراضي');
    }
    const ts = nowIso();
    this.state.assets = this.state.assets.map(a => {
      if (a.category_id !== target.category_id) return a;
      const isDef = a.id === target.id;
      return a.is_default === isDef
        ? a
        : { ...a, is_default: isDef, updated_at: ts, version: (a.version || 1) + 1 };
    });
    this.recordAudit(
      'asset_default_set',
      'assets',
      target.id,
      null,
      { is_default: true },
      `تعيين الأصل الافتراضي: ${target.asset_code}`,
      {
        asset_id: target.id,
        category_id: target.category_id,
      }
    );
    this.notify();
    return true;
  }

  async saveOperator(payload) {
    this.assertCanAdmin();
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('اسم المشغل مطلوب');
    const ts = nowIso();
    if (payload.id) {
      const idx = this.state.operators.findIndex(o => o.id === payload.id);
      const prev = this.state.operators[idx];
      this.checkVersion(prev, payload.version);
      const updated = {
        ...prev,
        name,
        phone: String(payload.phone ?? prev.phone ?? '').trim(),
        notes: String(payload.notes ?? prev.notes ?? '').trim(),
        status: payload.status || prev.status || 'active',
        version: (prev.version || 1) + 1,
        updated_at: ts,
      };
      this.state.operators[idx] = updated;
      this.recordAudit('operator_updated', 'operators', updated.id, prev, updated, `تحديث مشغل: ${updated.name}`);
      this.notify();
      return clone(updated);
    }
    const created = {
      id: uuid(),
      name,
      phone: String(payload.phone || '').trim(),
      notes: String(payload.notes || '').trim(),
      status: payload.status || 'active',
      version: 1,
      created_at: ts,
      updated_at: ts,
    };
    this.state.operators.push(created);
    this.recordAudit('operator_created', 'operators', created.id, null, created, `إضافة مشغل: ${created.name}`);
    this.notify();
    return clone(created);
  }

  async saveFuelType(payload) {
    this.assertCanAdmin();
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('اسم نوع الوقود مطلوب');
    const dup = this.state.fuel_types.find(
      f => f.id !== payload.id && f.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (dup) throw new Error('اسم نوع الوقود مستخدم مسبقاً');
    const ts = nowIso();
    if (payload.id) {
      const idx = this.state.fuel_types.findIndex(f => f.id === payload.id);
      const prev = this.state.fuel_types[idx];
      this.checkVersion(prev, payload.version);
      const updated = {
        ...prev,
        name,
        unit: String(payload.unit || prev.unit || 'لتر').trim(),
        status: payload.status || prev.status || 'active',
        version: (prev.version || 1) + 1,
        updated_at: ts,
      };
      this.state.fuel_types[idx] = updated;
      this.recordAudit('fuel_type_updated', 'fuel_types', updated.id, prev, updated, `تحديث نوع وقود: ${updated.name}`);
      this.notify();
      return clone(updated);
    }
    const created = {
      id: uuid(),
      name,
      unit: String(payload.unit || 'لتر').trim(),
      status: payload.status || 'active',
      version: 1,
      created_at: ts,
      updated_at: ts,
    };
    this.state.fuel_types.push(created);
    this.recordAudit('fuel_type_created', 'fuel_types', created.id, null, created, `إضافة نوع وقود: ${created.name}`);
    this.notify();
    return clone(created);
  }

  /** Pump water / tanker distribution for one log (mirrors save_operation_log in migration 005). */
  resolvePumpLog(asset, category, payload, existing, netDelta) {
    const empty = {
      pump_capacity_snapshot: null,
      water_total: null,
      tanker_id: null,
      trips_count: 0,
      distributed_quantity: 0,
      network_quantity: null,
    };
    if (assetKind(category) !== 'pump') return empty;
    const has = k => payload[k] !== undefined;
    const cap = Number(existing?.pump_capacity_snapshot ?? asset.pump_capacity);
    if (!(cap > 0)) throw new Error('قدرة المضخة غير محددة في بطاقة الأصل؛ أدخل قدرة المضخة (م³/ساعة) أولًا');
    const water = calcPumpWater(0, Number(netDelta || 0), cap);
    const tankerId = has('tanker_id') ? payload.tanker_id || null : existing ? existing.tanker_id || null : asset.default_tanker_id || null;
    const trips = has('trips_count') && payload.trips_count !== '' ? Number(payload.trips_count) : Number(existing?.trips_count || 0);
    const dist =
      has('distributed_quantity') && payload.distributed_quantity !== ''
        ? Number(payload.distributed_quantity)
        : Number(existing?.distributed_quantity || 0);
    const errs = validatePumpLog({ waterTotal: water, tripsCount: trips, distributed: dist, tankerId });
    if (errs.length) throw new Error(errs[0]);
    if (tankerId) {
      const t = this.state.assets.find(a => a.id === tankerId);
      const tc = t && this.state.categories.find(c => c.id === t.category_id);
      if (!t || assetKind(tc) !== 'tanker') throw new Error('الصهريج المختار يجب أن يكون من تصنيف صهاريج');
      if (t.status !== 'active' && tankerId !== existing?.tanker_id) throw new Error('لا يمكن اختيار صهريج غير نشط');
    }
    return {
      pump_capacity_snapshot: cap,
      water_total: water,
      tanker_id: tankerId,
      trips_count: trips,
      distributed_quantity: dist,
      network_quantity: calcNetwork(water, dist),
    };
  }

  async saveOperationLog(payload, values = {}) {
    this.assertCanWrite();
    const asset = this.state.assets.find(a => a.id === payload.asset_id);
    if (!asset) throw new Error('الأصل غير موجود');
    const category = this.state.categories.find(c => c.id === asset.category_id);
    if (!category) throw new Error('التصنيف غير موجود');

    const editing = Boolean(payload.id);
    if (!editing && asset.status !== 'active') {
      throw new Error('لا يمكن تسجيل تشغيل جديد لأصل غير نشط');
    }

    if (payload.operator_id) {
      const op = this.state.operators.find(o => o.id === payload.operator_id);
      if (!op) throw new Error('المشغل غير موجود');
      if (!editing && op.status !== 'active') {
        throw new Error('لا يمكن اختيار مشغل غير نشط في سجل جديد');
      }
    }

    const latest = latestOperationLog(this.state.operation_logs, asset.id);
    let existing = null;
    if (editing) {
      existing = this.state.operation_logs.find(l => l.id === payload.id);
      this.checkVersion(existing, payload.version);
      if (!latest || latest.id !== existing.id) {
        throw new Error('لا يمكن تعديل سوى آخر سجل تشغيل لهذا الأصل');
      }
    }

    const prevLog = previousOperationLog(this.state.operation_logs, asset.id, editing ? existing.id : null);
    const today = localTodayISO();
    const logDate = String(payload.operation_date || payload.log_date || '').trim();
    if (!logDate) throw new Error('تاريخ السجل مطلوب');
    if (logDate > today) {
      throw new Error('لا يُسمح بتسجيل تاريخ مستقبلي');
    }

    const dupSameDay = this.state.operation_logs.find(
      l =>
        l.asset_id === asset.id &&
        (l.operation_date === logDate || l.log_date === logDate) &&
        l.id !== (editing ? existing.id : null)
    );
    if (dupSameDay) {
      throw new Error('يوجد سجل تشغيل لهذا الأصل في نفس التاريخ مسبقاً');
    }

    if (prevLog) {
      const prevDate = prevLog.operation_date || prevLog.log_date;
      if (prevDate >= today && !editing) {
        throw new Error('تم تسجيل سجل اليوم لهذا الأصل، لا يمكن إضافة سجل جديد قبل اليوم التالي');
      }
      const minDate = nextDateISO(prevDate);
      if (logDate < minDate) {
        throw new Error(`تاريخ السجل يجب أن يكون في أو بعد ${minDate}`);
      }
    }

    const recordType = payload.record_type || 'daily';
    let prevReading = null;
    let currReading = null;
    let netDelta = null;

    if (category.uses_meter) {
      if (recordType === 'daily' && prevLog && prevLog.current_reading != null) {
        prevReading = Number(prevLog.current_reading);
      } else {
        if (payload.previous_reading === '' || payload.previous_reading == null) {
          throw new Error('القراءة السابقة مطلوبة');
        }
        prevReading = Number(payload.previous_reading);
      }
      if (payload.current_reading === '' || payload.current_reading == null) {
        throw new Error('القراءة الحالية مطلوبة');
      }
      currReading = Number(payload.current_reading);
      if (Number.isNaN(prevReading) || prevReading < 0) throw new Error('القراءة السابقة غير صالحة');
      if (Number.isNaN(currReading) || currReading < 0) throw new Error('القراءة الحالية غير صالحة');
      if (currReading < prevReading) {
        throw new Error('القراءة الحالية لا يمكن أن تقل عن القراءة السابقة');
      }
      netDelta = roundNum(currReading - prevReading);
    } else {
      const rawDelta = payload.net_operation_delta ?? payload.usage_value ?? 0;
      if (
        (payload.net_operation_delta === '' || payload.net_operation_delta == null) &&
        (payload.usage_value === '' || payload.usage_value == null)
      ) {
        throw new Error('صافي التشغيل مطلوب للأصول التي لا تستخدم عداداً');
      }
      netDelta = Number(rawDelta);
      if (Number.isNaN(netDelta) || netDelta < 0) {
        throw new Error('صافي التشغيل يجب أن يكون رقماً غير سالب');
      }
    }

    let fuelConsumed = null;
    const tankId = asset.fuel_type_id || null; // single tank per asset (null = بدون وقود)
    if (category.supports_fuel && tankId) {
      if (payload.fuel_consumed !== '' && payload.fuel_consumed != null) {
        fuelConsumed = Number(payload.fuel_consumed);
        if (Number.isNaN(fuelConsumed) || fuelConsumed < 0) throw new Error('كمية الوقود المستهلكة غير صالحة');
      } else {
        const effRate = effectiveValue(asset, category, 'fuel_rate');
        if (effRate != null && netDelta != null) {
          fuelConsumed = roundNum(netDelta * Number(effRate));
        }
      }
    }

    let chlorineConsumed = null;
    let residualChlorine = null;
    if (category.supports_chlorine) {
      if (payload.chlorine_consumed !== '' && payload.chlorine_consumed != null) {
        chlorineConsumed = Number(payload.chlorine_consumed);
        if (Number.isNaN(chlorineConsumed) || chlorineConsumed < 0) throw new Error('كمية الكلور المستهلكة غير صالحة');
      } else {
        const effCh = effectiveValue(asset, category, 'chlorine_consumption');
        if (effCh != null) chlorineConsumed = Number(effCh);
      }

      if (payload.residual_chlorine !== '' && payload.residual_chlorine != null) {
        residualChlorine = Number(payload.residual_chlorine);
        if (Number.isNaN(residualChlorine) || residualChlorine < 0) throw new Error('قيمة الكلور المتبقي غير صالحة');
      } else {
        const effRes = effectiveValue(asset, category, 'residual_chlorine');
        if (effRes != null) residualChlorine = Number(effRes);
      }
    }

    const pump = this.resolvePumpLog(asset, category, payload, existing, netDelta);

    const activeFields = this.validateScopedDynamicValues(category.id, 'operation_log', values);
    const ts = nowIso();

    if (editing) {
      const idx = this.state.operation_logs.findIndex(l => l.id === existing.id);
      const updated = {
        ...existing,
        operator_id: payload.operator_id !== undefined ? payload.operator_id || null : existing.operator_id,
        operation_date: logDate,
        log_date: logDate,
        record_type: recordType,
        previous_reading: prevReading,
        current_reading: currReading,
        usage_value: netDelta,
        net_operation_delta: netDelta,
        meter_unit_snapshot: category.uses_meter ? category.meter_unit : null,
        fuel_consumed: fuelConsumed,
        fuel_type_id: tankId,
        fuel_unit_snapshot: category.supports_fuel ? category.fuel_unit || 'لتر' : null,
        chlorine_consumed: chlorineConsumed,
        chlorine_unit_snapshot: category.supports_chlorine ? category.chlorine_unit || 'كجم' : null,
        residual_chlorine: residualChlorine,
        ...pump,
        notes: payload.notes !== undefined ? payload.notes : existing.notes,
        edited: true,
        version: (existing.version || 1) + 1,
        updated_at: ts,
        updated_by: this.user.id,
      };
      this.state.operation_logs[idx] = updated;
      this.persistDynamicValues('operation_log_field_values', 'operation_log_id', updated.id, activeFields, values);
      this.recordAudit(
        'operation_updated',
        'operation_logs',
        updated.id,
        existing,
        updated,
        `تعديل سجل تشغيل: ${asset.asset_code} (${logDate})`,
        {
          asset_id: asset.id,
          category_id: category.id,
        }
      );
      this.notify();
      return clone(updated);
    }

    const created = {
      id: uuid(),
      asset_id: asset.id,
      category_id: category.id,
      operator_id: payload.operator_id || null,
      operation_date: logDate,
      log_date: logDate,
      record_type: recordType,
      previous_reading: prevReading,
      current_reading: currReading,
      usage_value: netDelta,
      net_operation_delta: netDelta,
      meter_unit_snapshot: category.uses_meter ? category.meter_unit : null,
      fuel_consumed: fuelConsumed,
      fuel_type_id: tankId,
      fuel_unit_snapshot: category.supports_fuel ? category.fuel_unit || 'لتر' : null,
      chlorine_consumed: chlorineConsumed,
      chlorine_unit_snapshot: category.supports_chlorine ? category.chlorine_unit || 'كجم' : null,
      residual_chlorine: residualChlorine,
      ...pump,
      notes: payload.notes || '',
      edited: false,
      version: 1,
      created_at: ts,
      updated_at: ts,
      created_by: this.user.id,
      updated_by: this.user.id,
    };
    this.state.operation_logs.push(created);
    this.persistDynamicValues('operation_log_field_values', 'operation_log_id', created.id, activeFields, values);
    const evtType = recordType === 'meter_reset' ? 'meter_reset' : 'operation_created';
    this.recordAudit(
      evtType,
      'operation_logs',
      created.id,
      null,
      created,
      `إضافة سجل تشغيل: ${asset.asset_code} (${logDate})`,
      {
        asset_id: asset.id,
        category_id: category.id,
      }
    );
    this.notify();
    return clone(created);
  }

  async deleteOperationLog(id, version) {
    this.assertCanWrite();
    const existing = this.state.operation_logs.find(l => l.id === id);
    this.checkVersion(existing, version);
    const latest = latestOperationLog(this.state.operation_logs, existing.asset_id);
    if (!latest || latest.id !== existing.id) {
      throw new Error('لا يمكن حذف سوى آخر سجل تشغيل لهذا الأصل');
    }
    this.state.operation_logs = this.state.operation_logs.filter(l => l.id !== id);
    this.state.operation_log_field_values = this.state.operation_log_field_values.filter(
      v => v.operation_log_id !== id
    );
    this.state.operation_log_values = clone(this.state.operation_log_field_values);
    this.recordAudit(
      'operation_deleted',
      'operation_logs',
      existing.id,
      existing,
      null,
      `حذف سجل تشغيل (${existing.operation_date || existing.log_date})`,
      {
        asset_id: existing.asset_id,
        category_id: existing.category_id,
      }
    );
    this.notify();
    return true;
  }

  async saveFuelTransaction(payload) {
    this.assertCanWrite();
    const txType = payload.transaction_type;
    if (!VALID_FUEL_TYPES.has(txType)) {
      throw new Error('نوع حركة الوقود غير صالح');
    }
    const ft = this.state.fuel_types.find(f => f.id === payload.fuel_type_id);
    if (!ft) throw new Error('نوع الوقود غير موجود');
    const editing = Boolean(payload.id);
    if (!editing && ft.status !== 'active') {
      throw new Error('لا يمكن تسجيل حركة جديدة على نوع وقود غير نشط');
    }

    let asset = null;
    if (txType === 'dispense' || payload.asset_id) {
      if (txType === 'dispense' && !payload.asset_id) throw new Error('يجب تحديد الأصل عند صرف الوقود');
      if (payload.asset_id) {
        asset = this.state.assets.find(a => a.id === payload.asset_id);
        if (!asset) throw new Error('الأصل غير موجود');
        const cat = this.state.categories.find(c => c.id === asset.category_id);
        if (!cat?.supports_fuel) throw new Error('هذا الأصل لا يدعم الوقود');
        if (!asset.fuel_type_id) throw new Error('هذا الأصل بلا خزان وقود؛ حدّد نوع الوقود في بطاقة الأصل أولًا');
        if (asset.fuel_type_id !== ft.id) throw new Error('نوع الوقود في الحركة يجب أن يطابق خزان الأصل (خزان واحد لكل أصل)');
        if (!editing && asset.status !== 'active') throw new Error('لا يمكن الصرف لأصل غير نشط');
      }
    }

    const txDate = String(payload.transaction_date || '').trim();
    if (!txDate) throw new Error('تاريخ الحركة مطلوب');
    if (txDate > localTodayISO()) throw new Error('لا يُسمح بتسجيل تاريخ مستقبلي');

    const isAdj = txType === 'adjustment' || txType === 'adjustment_plus' || txType === 'adjustment_minus';
    const qty = Number(payload.quantity);
    if (Number.isNaN(qty) || (txType === 'adjustment' ? qty === 0 : qty <= 0)) {
      throw new Error(txType === 'adjustment' ? 'كمية التسوية لا يمكن أن تكون صفراً' : 'الكمية يجب أن تكون أكبر من الصفر');
    }
    if (isAdj && !String(payload.notes || payload.adjustment_reason || '').trim()) {
      throw new Error('الملاحظات أو سبب التسوية إلزامي عند تسجيل تسوية جردية');
    }

    let existing = null;
    if (editing) {
      existing = this.state.fuel_transactions.find(t => t.id === payload.id);
      this.checkVersion(existing, payload.version);
      const latest = latestFuelTransaction(this.state.fuel_transactions, existing.fuel_type_id);
      if (!latest || latest.id !== existing.id) {
        throw new Error('لا يمكن تعديل سوى آخر حركة لهذا النوع من الوقود');
      }
    }

    const otherTxs = editing
      ? this.state.fuel_transactions.filter(t => t.id !== existing.id)
      : this.state.fuel_transactions;
    const simulated = [
      ...otherTxs,
      { fuel_type_id: ft.id, asset_id: asset?.id || null, transaction_type: txType, quantity: qty },
    ];
    const nextBalance = calculateFuelBalance(simulated, ft.id);
    if (nextBalance < 0) {
      throw new Error(`الرصيد غير كافٍ: هذه الحركة تؤدي إلى رصيد وقود سالب (${nextBalance} ${ft.unit})`);
    }

    const ts = nowIso();
    if (editing) {
      const idx = this.state.fuel_transactions.findIndex(t => t.id === existing.id);
      const updated = {
        ...existing,
        fuel_type_id: ft.id,
        asset_id: asset?.id || null,
        operator_id: payload.operator_id || null,
        transaction_type: txType,
        transaction_date: txDate,
        quantity: qty,
        unit_snapshot: ft.unit,
        supplier: payload.supplier ?? existing.supplier ?? '',
        invoice_number: payload.invoice_number ?? existing.invoice_number ?? '',
        adjustment_reason: payload.adjustment_reason ?? existing.adjustment_reason ?? '',
        reference_no: payload.reference_no ?? existing.reference_no ?? '',
        notes: payload.notes ?? existing.notes ?? '',
        edited: true,
        version: (existing.version || 1) + 1,
        updated_at: ts,
        updated_by: this.user.id,
      };
      this.state.fuel_transactions[idx] = updated;
      this.recordAudit(
        'fuel_updated',
        'fuel_transactions',
        updated.id,
        existing,
        updated,
        `تعديل حركة وقود (${ft.name}): ${qty} ${ft.unit}`,
        {
          asset_id: updated.asset_id,
          category_id: asset?.category_id || null,
        }
      );
      this.notify();
      return clone(updated);
    }

    const created = {
      id: uuid(),
      fuel_type_id: ft.id,
      asset_id: asset?.id || null,
      operator_id: payload.operator_id || null,
      transaction_type: txType,
      transaction_date: txDate,
      quantity: qty,
      unit_snapshot: ft.unit,
      supplier: payload.supplier || '',
      invoice_number: payload.invoice_number || '',
      adjustment_reason: payload.adjustment_reason || '',
      reference_no: payload.reference_no || '',
      notes: payload.notes || '',
      edited: false,
      version: 1,
      created_at: ts,
      updated_at: ts,
      created_by: this.user.id,
      updated_by: this.user.id,
    };
    this.state.fuel_transactions.push(created);
    this.recordAudit(
      `fuel_${txType}`,
      'fuel_transactions',
      created.id,
      null,
      created,
      `حركة وقود (${ft.name}): ${qty} ${ft.unit}`,
      {
        asset_id: created.asset_id,
        category_id: asset?.category_id || null,
      }
    );
    this.notify();
    return clone(created);
  }

  async deleteFuelTransaction(id, version) {
    this.assertCanWrite();
    const existing = this.state.fuel_transactions.find(t => t.id === id);
    this.checkVersion(existing, version);
    const latest = latestFuelTransaction(this.state.fuel_transactions, existing.fuel_type_id);
    if (!latest || latest.id !== existing.id) {
      throw new Error('لا يمكن حذف سوى آخر حركة لهذا النوع من الوقود');
    }
    const remaining = this.state.fuel_transactions.filter(t => t.id !== id);
    if (calculateFuelBalance(remaining, existing.fuel_type_id) < 0) {
      throw new Error('لا يمكن حذف هذه الحركة لأن حذفها يؤدي إلى رصيد وقود سالب');
    }
    this.state.fuel_transactions = remaining;
    this.recordAudit(
      'fuel_deleted',
      'fuel_transactions',
      existing.id,
      existing,
      null,
      `حذف حركة وقود (${existing.quantity} ${existing.unit_snapshot})`,
      {
        asset_id: existing.asset_id,
      }
    );
    this.notify();
    return true;
  }

  async saveChlorineTransaction(payload) {
    this.assertCanWrite();
    const txType = payload.transaction_type;
    if (!VALID_CHLORINE_TYPES.has(txType)) {
      throw new Error('نوع حركة الكلور غير صالح');
    }
    const editing = Boolean(payload.id);
    let asset = null;
    if (txType === 'dispense' || payload.asset_id) {
      if (txType === 'dispense' && !payload.asset_id) throw new Error('يجب تحديد الأصل عند صرف الكلور');
      if (payload.asset_id) {
        asset = this.state.assets.find(a => a.id === payload.asset_id);
        if (!asset) throw new Error('الأصل غير موجود');
        const cat = this.state.categories.find(c => c.id === asset.category_id);
        if (!cat?.supports_chlorine) throw new Error('هذا الأصل لا يدعم الكلور');
        if (!editing && asset.status !== 'active') throw new Error('لا يمكن الصرف لأصل غير نشط');
      }
    }

    const txDate = String(payload.transaction_date || '').trim();
    if (!txDate) throw new Error('تاريخ الحركة مطلوب');
    if (txDate > localTodayISO()) throw new Error('لا يُسمح بتسجيل تاريخ مستقبلي');

    const isAdj = txType === 'adjustment' || txType === 'adjustment_plus' || txType === 'adjustment_minus';
    const qty = Number(payload.quantity);
    if (Number.isNaN(qty) || (txType === 'adjustment' ? qty === 0 : qty <= 0)) {
      throw new Error(txType === 'adjustment' ? 'كمية التسوية لا يمكن أن تكون صفراً' : 'الكمية يجب أن تكون أكبر من الصفر');
    }
    if (isAdj && !String(payload.notes || payload.adjustment_reason || '').trim()) {
      throw new Error('الملاحظات أو سبب التسوية إلزامي عند تسجيل تسوية جردية للكلور');
    }

    let existing = null;
    if (editing) {
      existing = this.state.chlorine_transactions.find(t => t.id === payload.id);
      this.checkVersion(existing, payload.version);
      const latest = latestChlorineTransaction(this.state.chlorine_transactions);
      if (!latest || latest.id !== existing.id) {
        throw new Error('لا يمكن تعديل سوى آخر حركة كلور');
      }
    }

    const otherTxs = editing
      ? this.state.chlorine_transactions.filter(t => t.id !== existing.id)
      : this.state.chlorine_transactions;
    const simulated = [
      ...otherTxs,
      { asset_id: asset?.id || null, transaction_type: txType, quantity: qty },
    ];
    const nextBalance = calculateChlorineBalance(simulated);
    if (nextBalance < 0) {
      throw new Error(`الرصيد غير كافٍ: هذه الحركة تؤدي إلى رصيد كلور سالب (${nextBalance})`);
    }

    const ts = nowIso();
    const unitSnap = payload.unit_snapshot || 'كجم';
    if (editing) {
      const idx = this.state.chlorine_transactions.findIndex(t => t.id === existing.id);
      const updated = {
        ...existing,
        asset_id: asset?.id || null,
        operator_id: payload.operator_id || null,
        transaction_type: txType,
        transaction_date: txDate,
        quantity: qty,
        unit_snapshot: unitSnap,
        residual_chlorine:
          payload.residual_chlorine !== '' && payload.residual_chlorine != null
            ? Number(payload.residual_chlorine)
            : null,
        supplier: payload.supplier ?? existing.supplier ?? '',
        adjustment_reason: payload.adjustment_reason ?? existing.adjustment_reason ?? '',
        reference_no: payload.reference_no ?? existing.reference_no ?? '',
        notes: payload.notes ?? existing.notes ?? '',
        edited: true,
        version: (existing.version || 1) + 1,
        updated_at: ts,
        updated_by: this.user.id,
      };
      this.state.chlorine_transactions[idx] = updated;
      this.recordAudit(
        'chlorine_updated',
        'chlorine_transactions',
        updated.id,
        existing,
        updated,
        `تعديل حركة كلور: ${qty} ${unitSnap}`,
        {
          asset_id: updated.asset_id,
          category_id: asset?.category_id || null,
        }
      );
      this.notify();
      return clone(updated);
    }

    const created = {
      id: uuid(),
      asset_id: asset?.id || null,
      operator_id: payload.operator_id || null,
      transaction_type: txType,
      transaction_date: txDate,
      quantity: qty,
      unit_snapshot: unitSnap,
      residual_chlorine:
        payload.residual_chlorine !== '' && payload.residual_chlorine != null
          ? Number(payload.residual_chlorine)
          : null,
      supplier: payload.supplier || '',
      adjustment_reason: payload.adjustment_reason || '',
      reference_no: payload.reference_no || '',
      notes: payload.notes || '',
      edited: false,
      version: 1,
      created_at: ts,
      updated_at: ts,
      created_by: this.user.id,
      updated_by: this.user.id,
    };
    this.state.chlorine_transactions.push(created);
    this.recordAudit(
      `chlorine_${txType}`,
      'chlorine_transactions',
      created.id,
      null,
      created,
      `حركة كلور: ${qty} ${unitSnap}`,
      {
        asset_id: created.asset_id,
        category_id: asset?.category_id || null,
      }
    );
    this.notify();
    return clone(created);
  }

  async deleteChlorineTransaction(id, version) {
    this.assertCanWrite();
    const existing = this.state.chlorine_transactions.find(t => t.id === id);
    this.checkVersion(existing, version);
    const latest = latestChlorineTransaction(this.state.chlorine_transactions);
    if (!latest || latest.id !== existing.id) {
      throw new Error('لا يمكن حذف سوى آخر حركة كلور');
    }
    const remaining = this.state.chlorine_transactions.filter(t => t.id !== id);
    if (calculateChlorineBalance(remaining) < 0) {
      throw new Error('لا يمكن حذف هذه الحركة لأن حذفها يؤدي إلى رصيد كلور سالب');
    }
    this.state.chlorine_transactions = remaining;
    this.recordAudit(
      'chlorine_deleted',
      'chlorine_transactions',
      existing.id,
      existing,
      null,
      `حذف حركة كلور (${existing.quantity} ${existing.unit_snapshot})`,
      {
        asset_id: existing.asset_id,
      }
    );
    this.notify();
    return true;
  }

  async saveProfile(payload) {
    this.assertCanAdmin();
    const ts = nowIso();
    if (payload.id) {
      const idx = this.state.profiles.findIndex(p => p.id === payload.id);
      if (idx >= 0) {
        const prev = this.state.profiles[idx];
        const updated = {
          ...prev,
          full_name: String(payload.full_name ?? prev.full_name).trim(),
          email: payload.email ?? prev.email ?? '',
          role: payload.role || prev.role || 'viewer',
          status: payload.status || prev.status || 'active',
          updated_at: ts,
        };
        this.state.profiles[idx] = updated;
        this.recordAudit(
          'profile_updated',
          'profiles',
          updated.id,
          prev,
          updated,
          `تحديث مستخدم: ${updated.full_name} (${updated.role})`
        );
        this.notify();
        return clone(updated);
      }
    }
    const created = {
      id: payload.id || uuid(),
      full_name: String(payload.full_name || '').trim(),
      email: payload.email || '',
      role: payload.role || 'viewer',
      status: payload.status || 'active',
      created_at: ts,
      updated_at: ts,
    };
    this.state.profiles.push(created);
    this.recordAudit(
      'profile_created',
      'profiles',
      created.id,
      null,
      created,
      `إضافة مستخدم: ${created.full_name} (${created.role})`
    );
    this.notify();
    return clone(created);
  }

  async saveSetting(key, value) {
    this.assertCanAdmin();
    const idx = this.state.app_settings.findIndex(s => s.key === key);
    const updated = { key, value, updated_at: nowIso() };
    if (idx >= 0) this.state.app_settings[idx] = updated;
    else this.state.app_settings.push(updated);
    this.recordAudit('setting_updated', 'app_settings', null, null, updated, `تحديث إعداد: ${key}`);
    this.notify();
    return clone(updated);
  }

  async exportBackup() {
    this.assertCanAdmin();
    return {
      schema_version: BACKUP_SCHEMA_VERSION,
      exported_at: nowIso(),
      data: {
        profiles: clone(this.state.profiles),
        categories: clone(this.state.categories),
        category_fields: clone(this.state.category_fields),
        category_field_options: clone(this.state.category_field_options),
        assets: clone(this.state.assets),
        asset_field_values: clone(this.state.asset_field_values),
        operators: clone(this.state.operators),
        fuel_types: clone(this.state.fuel_types),
        operation_logs: clone(this.state.operation_logs),
        operation_log_field_values: clone(this.state.operation_log_field_values),
        operation_log_values: clone(this.state.operation_log_field_values),
        fuel_transactions: clone(this.state.fuel_transactions),
        chlorine_transactions: clone(this.state.chlorine_transactions),
        timeline_events: clone(this.state.timeline_events),
        app_settings: clone(this.state.app_settings),
      },
    };
  }

  async restoreBackup(backupDoc, options = {}) {
    this.assertCanAdmin();
    const validation = validateAndPreviewBackup(backupDoc, options.rawByteLength || 0);
    if (!validation.valid) {
      throw new Error(`فشل التحقق من النسخة الاحتياطية: ${validation.errors.join(' | ')}`);
    }

    const previousState = clone(this.state);
    try {
      if (options.simulateFailureMidFlight) {
        throw new Error('فشل محاكى أثناء الاستعادة لاختبار التراجع الذري (Atomic Rollback)');
      }
      const d = clone(backupDoc.data || backupDoc);
      if (!d.operation_log_field_values && Array.isArray(d.operation_log_values)) {
        d.operation_log_field_values = d.operation_log_values;
      }
      this.state = {
        ...INITIAL_AOMS_STATE(),
        profiles: d.profiles || [],
        categories: d.categories || [],
        category_fields: d.category_fields || [],
        category_field_options: d.category_field_options || [],
        assets: d.assets || [],
        asset_field_values: d.asset_field_values || [],
        operators: d.operators || [],
        fuel_types: d.fuel_types || [],
        operation_logs: d.operation_logs || [],
        operation_log_field_values: d.operation_log_field_values || [],
        operation_log_values: d.operation_log_field_values || [],
        fuel_transactions: d.fuel_transactions || [],
        chlorine_transactions: d.chlorine_transactions || [],
        timeline_events: d.timeline_events || [],
        audit_logs: previousState.audit_logs || [],
        app_settings: d.app_settings || INITIAL_AOMS_STATE().app_settings,
      };
      this.recordAudit(
        'backup_restored',
        'system',
        null,
        null,
        validation.counts,
        `استعادة نسخة احتياطية كاملة (${validation.counts.assets} أصل، ${validation.counts.operation_logs} سجل تشغيل)`
      );
      this.notify();
      return validation.counts;
    } catch (err) {
      this.state = previousState;
      throw err;
    }
  }
}

export const REQUIRED_BACKUP_KEYS = [
  'categories',
  'category_fields',
  'category_field_options',
  'assets',
  'asset_field_values',
  'operators',
  'fuel_types',
  'operation_logs',
  'operation_log_field_values',
  'fuel_transactions',
  'chlorine_transactions',
  'timeline_events',
  'app_settings',
];

export function validateAndPreviewBackup(backupDoc, rawByteLength = 0) {
  const errors = [];
  if (rawByteLength > BACKUP_MAX_BYTES) {
    errors.push('حجم ملف النسخة الاحتياطية يتجاوز الحد الأقصى المسموح به (25MB)');
  }
  if (!backupDoc || typeof backupDoc !== 'object') {
    return { valid: false, errors: ['ملف النسخة الاحتياطية غير صالح'], counts: {} };
  }
  const serializedSize = rawByteLength || new TextEncoder().encode(JSON.stringify(backupDoc)).length;
  if (serializedSize > BACKUP_MAX_BYTES) {
    errors.push('حجم بيانات النسخة الاحتياطية يتجاوز الحد الأقصى المسموح به (25MB)');
  }
  if (backupDoc.schema_version !== BACKUP_SCHEMA_VERSION && backupDoc.schema_version !== '2.0.0') {
    errors.push(`إصدار المخطط غير مدعوم (${backupDoc.schema_version || 'غير محدد'}) — المطلوب ${BACKUP_SCHEMA_VERSION}`);
  }
  const src = backupDoc.data || (Array.isArray(backupDoc.categories) ? backupDoc : null);
  if (!src || typeof src !== 'object') {
    return { valid: false, errors: [...errors, 'قسم البيانات data مفقود في ملف النسخة الاحتياطية'], counts: {} };
  }
  // Work on a shallow copy so the caller's document is not mutated before it is sent to restore.
  const d = { ...src };
  if (!d.operation_log_field_values && Array.isArray(d.operation_log_values)) {
    d.operation_log_field_values = d.operation_log_values;
  }
  // timeline_events / app_settings are optional for backups exported before migration 202610260003
  if (d.timeline_events == null) d.timeline_events = [];
  if (d.app_settings == null) d.app_settings = [];

  for (const key of REQUIRED_BACKUP_KEYS) {
    if (!Array.isArray(d[key])) {
      errors.push(`الجدول المطلوب «${key}» مفقود أو ليس مصفوفة`);
    }
  }
  if (errors.length) {
    return { valid: false, errors, counts: {} };
  }

  const catIds = new Set(d.categories.map(c => c.id));
  const fieldIds = new Set(d.category_fields.map(f => f.id));
  const assetIds = new Set(d.assets.map(a => a.id));
  const logIds = new Set(d.operation_logs.map(l => l.id));
  const fuelTypeIds = new Set(d.fuel_types.map(f => f.id));

  for (const a of d.assets) {
    if (!catIds.has(a.category_id)) {
      errors.push(`الأصل ${a.asset_code || a.id} يشير إلى تصنيف غير موجود (${a.category_id})`);
    }
  }
  for (const f of d.category_fields) {
    if (!catIds.has(f.category_id)) {
      errors.push(`الحقل الديناميكي ${f.field_key || f.id} يشير إلى تصنيف غير موجود`);
    }
  }
  for (const o of d.category_field_options) {
    if (!fieldIds.has(o.field_id)) {
      errors.push(`خيار الحقل ${o.label || o.id} يشير إلى حقل غير موجود`);
    }
  }
  for (const v of d.asset_field_values) {
    if (!assetIds.has(v.asset_id) || !fieldIds.has(v.field_id)) {
      errors.push('قيمة حقل أصل تشير إلى أصل أو حقل غير موجود');
    }
  }
  for (const l of d.operation_logs) {
    // the production table has no category_id column (category comes from the asset)
    if (!assetIds.has(l.asset_id) || (l.category_id != null && !catIds.has(l.category_id))) {
      errors.push(`سجل التشغيل ${l.id} يشير إلى أصل أو تصنيف غير موجود`);
    }
  }
  for (const v of d.operation_log_field_values) {
    if (!logIds.has(v.operation_log_id) || !fieldIds.has(v.field_id)) {
      errors.push('قيمة حقل سجل تشغيل تشير إلى سجل أو حقل غير موجود');
    }
  }
  for (const ft of d.fuel_transactions) {
    if (!fuelTypeIds.has(ft.fuel_type_id)) {
      errors.push(`حركة الوقود ${ft.id} تشير إلى نوع وقود غير موجود`);
    }
    if (ft.asset_id && !assetIds.has(ft.asset_id)) {
      errors.push(`حركة الوقود ${ft.id} تشير إلى أصل غير موجود`);
    }
  }
  for (const ct of d.chlorine_transactions) {
    if (ct.asset_id && !assetIds.has(ct.asset_id)) {
      errors.push(`حركة الكلور ${ct.id} يشير إلى أصل غير موجود`);
    }
  }

  const counts = Object.fromEntries(REQUIRED_BACKUP_KEYS.map(k => [k, d[k].length]));
  return {
    valid: errors.length === 0,
    errors,
    counts,
    exported_at: backupDoc.exported_at,
    schema_version: backupDoc.schema_version,
  };
}

export function globalSearchState(state, query, userProfile = null) {
  const q = String(query || '').trim().toLowerCase();
  const emptyArr = [];
  emptyArr.assets = [];
  emptyArr.categories = [];
  emptyArr.operators = [];
  emptyArr.operation_logs = [];
  emptyArr.fuel_transactions = [];
  emptyArr.chlorine_transactions = [];
  emptyArr.timeline_events = [];
  emptyArr.total = 0;
  if (!q) return emptyArr;

  const matchText = (...vals) =>
    vals.some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q));

  const assetDynText = assetId =>
    (state.asset_field_values || [])
      .filter(v => v.asset_id === assetId)
      .map(v => {
        const optId = v.option_id || v.value_option_id;
        if (optId) {
          const opt = (state.category_field_options || []).find(o => o.id === optId);
          return opt?.label || '';
        }
        return v.value_text ?? v.value_number ?? v.value_date ?? '';
      })
      .join(' ');

  const logVals = state.operation_log_field_values || state.operation_log_values || [];
  const logDynText = logId =>
    logVals
      .filter(v => v.operation_log_id === logId)
      .map(v => {
        const optId = v.option_id || v.value_option_id;
        if (optId) {
          const opt = (state.category_field_options || []).find(o => o.id === optId);
          return opt?.label || '';
        }
        return v.value_text ?? v.value_number ?? v.value_date ?? '';
      })
      .join(' ');

  const assets = (state.assets || []).filter(a =>
    matchText(a.asset_code, a.name, a.location, a.notes, assetDynText(a.id))
  );
  const categories = (state.categories || []).filter(c =>
    matchText(c.name, c.code_prefix, c.description, c.meter_unit)
  );
  const operators = (state.operators || []).filter(o =>
    matchText(o.name, o.phone, o.notes)
  );
  const operation_logs = (state.operation_logs || []).filter(l => {
    const asset = (state.assets || []).find(a => a.id === l.asset_id);
    const op = (state.operators || []).find(o => o.id === l.operator_id);
    return matchText(
      l.operation_date || l.log_date,
      l.notes,
      asset?.asset_code,
      asset?.name,
      op?.name,
      logDynText(l.id)
    );
  });
  const fuel_transactions = (state.fuel_transactions || []).filter(t => {
    const ft = (state.fuel_types || []).find(f => f.id === t.fuel_type_id);
    const asset = (state.assets || []).find(a => a.id === t.asset_id);
    return matchText(
      t.transaction_date,
      t.reference_no,
      t.supplier,
      t.invoice_number,
      t.notes,
      ft?.name,
      asset?.asset_code,
      asset?.name
    );
  });
  const chlorine_transactions = (state.chlorine_transactions || []).filter(t => {
    const asset = (state.assets || []).find(a => a.id === t.asset_id);
    return matchText(t.transaction_date, t.reference_no, t.supplier, t.notes, asset?.asset_code, asset?.name);
  });
  const timeline_events = (state.timeline_events || []).filter(e =>
    matchText(e.event_type, e.entity_type, e.summary, e.title, e.description)
  );

  const flatItems = [
    ...categories.map(c => ({
      entity_type: 'category',
      entity_id: c.id,
      record_id: c.id,
      tab_key: 'categories',
      title: `${c.code_prefix} — ${c.name}`,
      subtitle: c.meter_unit || 'بلا عداد',
    })),
    ...assets.map(a => ({
      entity_type: 'asset',
      entity_id: a.id,
      asset_id: a.id,
      record_id: a.id,
      tab_key: 'assets',
      title: `${a.asset_code} — ${a.name}`,
      subtitle: a.location || '—',
    })),
    ...operators.map(o => ({
      entity_type: 'operator',
      entity_id: o.id,
      record_id: o.id,
      tab_key: 'operators',
      title: o.name,
      subtitle: o.phone || '—',
    })),
    ...operation_logs.map(l => ({
      entity_type: 'operation_log',
      entity_id: l.id,
      asset_id: l.asset_id,
      record_id: l.id,
      tab_key: 'operation_logs',
      title: `سجل تشغيل (${l.operation_date || l.log_date})`,
      subtitle: l.notes || '—',
    })),
    ...fuel_transactions.map(t => ({
      entity_type: 'fuel_transaction',
      entity_id: t.id,
      asset_id: t.asset_id,
      record_id: t.id,
      tab_key: 'fuel_transactions',
      title: `حركة وقود (${t.transaction_date})`,
      subtitle: `${t.quantity} ${t.unit_snapshot || ''}`,
    })),
    ...chlorine_transactions.map(t => ({
      entity_type: 'chlorine_transaction',
      entity_id: t.id,
      asset_id: t.asset_id,
      record_id: t.id,
      tab_key: 'chlorine_transactions',
      title: `حركة كلور (${t.transaction_date})`,
      subtitle: `${t.quantity} ${t.unit_snapshot || ''}`,
    })),
  ];

  flatItems.assets = assets;
  flatItems.categories = categories;
  flatItems.operators = operators;
  flatItems.operation_logs = operation_logs;
  flatItems.fuel_transactions = fuel_transactions;
  flatItems.chlorine_transactions = chlorine_transactions;
  flatItems.timeline_events = timeline_events;
  if (userProfile && canAdmin(userProfile)) {
    flatItems.audit_logs = (state.audit_logs || []).filter(a =>
      matchText(a.event_type, a.action, a.entity_type)
    );
  }
  flatItems.total =
    assets.length +
    categories.length +
    operators.length +
    operation_logs.length +
    fuel_transactions.length +
    chlorine_transactions.length +
    timeline_events.length;
  return flatItems;
}

export function buildAomsReport(state, filters = {}) {
  const type =
    filters.type ||
    (filters.eventType === 'fuel'
      ? 'fuel'
      : filters.eventType === 'chlorine'
        ? 'chlorine'
        : 'operations');
  const from = filters.from || '';
  const to = filters.to || '';
  const category_id = filters.category_id || filters.categoryId || 'all';
  const asset_id = filters.asset_id || filters.assetId || 'all';
  const assetIds = Array.isArray(filters.assetIds) ? filters.assetIds : [];
  const operator_id = filters.operator_id || filters.operatorId || 'all';
  const record_type = filters.record_type || 'all';
  const fuel_type_id = filters.fuel_type_id || 'all';
  const status = filters.status || 'all';
  const edited = filters.edited || 'all';
  const q = filters.q || '';
  const dynamic_filters = filters.dynamic_filters || {};
  const include_dynamic_fields = filters.include_dynamic_fields !== false;

  const query = String(q || '').trim().toLowerCase();
  const inDateRange = d => {
    if (!d) return true;
    const iso = String(d).slice(0, 10);
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  };

  const resolveDynValue = (valRow, field) => {
    if (!valRow) return '';
    if (field.field_type === 'select') {
      const optId = valRow.option_id || valRow.value_option_id;
      const opt = (state.category_field_options || []).find(o => o.id === optId);
      return opt?.label || '';
    }
    if (field.field_type === 'boolean') {
      return valRow.value_boolean === true ? 'نعم' : valRow.value_boolean === false ? 'لا' : '';
    }
    return valRow.value_text ?? valRow.value_number ?? valRow.value_date ?? '';
  };

  let dynamicColumns =
    include_dynamic_fields && category_id && category_id !== 'all'
      ? (state.category_fields || [])
          .filter(
            f =>
              f.category_id === category_id &&
              f.is_active &&
              f.show_in_reports &&
              (type === 'assets'
                ? f.scope === 'asset'
                : type === 'operations'
                  ? isOpScope(f.scope)
                  : false)
          )
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : [];

  const logValuesAll = state.operation_log_field_values || state.operation_log_values || [];
  const assetById = new Map((state.assets || []).map(a => [a.id, a]));
  const catById = new Map((state.categories || []).map(c => [c.id, c]));
  // production rows have no category_id/edited/meter_unit_snapshot columns: derive them
  const logCategoryId = l => l.category_id ?? assetById.get(l.asset_id)?.category_id ?? null;
  const isEdited = r => (r.edited != null ? Boolean(r.edited) : Number(r.version || 1) > 1);

  let rows = [];
  if (type === 'operations') {
    rows = (state.operation_logs || [])
      .filter(l => {
        const dStr = l.operation_date || l.log_date;
        if (!inDateRange(dStr)) return false;
        if (category_id !== 'all' && logCategoryId(l) !== category_id) return false;
        if (asset_id !== 'all' && l.asset_id !== asset_id) return false;
        if (filters.scope === 'multi_assets' && assetIds.length > 0 && !assetIds.includes(l.asset_id)) return false;
        if (operator_id !== 'all' && l.operator_id !== operator_id) return false;
        if (record_type !== 'all' && l.record_type !== record_type) return false;
        if (edited === 'edited' && !isEdited(l)) return false;
        if (edited === 'original' && isEdited(l)) return false;
        const asset = (state.assets || []).find(a => a.id === l.asset_id);
        if (status !== 'all' && asset?.status !== status) return false;
        if (fuel_type_id !== 'all' && asset?.fuel_type_id !== fuel_type_id) return false;
        for (const [fId, fVal] of Object.entries(dynamic_filters || {})) {
          if (fVal === '' || fVal === 'all' || fVal == null) continue;
          const vRow = logValuesAll.find(
            v => v.operation_log_id === l.id && v.field_id === fId
          );
          const fDef = (state.category_fields || []).find(f => f.id === fId);
          const actual = fDef ? String(resolveDynValue(vRow, fDef)) : '';
          if (!actual.toLowerCase().includes(String(fVal).toLowerCase())) return false;
        }
        if (query) {
          const op = (state.operators || []).find(o => o.id === l.operator_id);
          const cat = catById.get(logCategoryId(l));
          const hay = [dStr, l.notes, asset?.asset_code, asset?.name, op?.name, cat?.name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .map(l => {
        const asset = (state.assets || []).find(a => a.id === l.asset_id);
        const cat = catById.get(logCategoryId(l));
        const op = (state.operators || []).find(o => o.id === l.operator_id);
        const dyn = {};
        for (const f of dynamicColumns) {
          const vRow = logValuesAll.find(
            v => v.operation_log_id === l.id && v.field_id === f.id
          );
          dyn[`dyn_${f.field_key}`] = resolveDynValue(vRow, f);
        }
        const dStr = l.operation_date || l.log_date;
        const delta = l.net_operation_delta ?? l.usage_value ?? 0;
        return {
          ...l,
          category_id: logCategoryId(l),
          edited: isEdited(l),
          meter_unit_snapshot: l.meter_unit_snapshot ?? (cat?.uses_meter ? cat?.meter_unit : null),
          log_date: dStr,
          operation_date: dStr,
          net_operation_delta: delta,
          usage_value: delta,
          asset_code: asset?.asset_code || '—',
          asset_name: asset?.name || '—',
          category_name: cat?.name || '—',
          operator_name: op?.name || '—',
          record_type_label: l.record_type === 'meter_reset' ? 'تغيير عداد' : 'سجل يومي',
          status_label: isEdited(l) ? 'معدّل' : 'أصلي',
          tanker_label: l.tanker_id ? tankerLabel((state.assets || []).find(a => a.id === l.tanker_id)) || '—' : '',
          water_total: l.water_total ?? (assetKind(cat) === 'pump' ? 0 : ''),
          trips_count: assetKind(cat) === 'pump' ? Number(l.trips_count || 0) : l.trips_count ?? '',
          distributed_quantity: assetKind(cat) === 'pump' ? Number(l.distributed_quantity || 0) : l.distributed_quantity ?? '',
          network_quantity: l.network_quantity ?? (assetKind(cat) === 'pump' ? Number(l.water_total || 0) : ''),
          ...dyn,
        };
      });
  } else if (type === 'fuel') {
    rows = (state.fuel_transactions || [])
      .filter(t => {
        if (!inDateRange(t.transaction_date)) return false;
        if (fuel_type_id !== 'all' && t.fuel_type_id !== fuel_type_id) return false;
        if (asset_id !== 'all' && t.asset_id !== asset_id) return false;
        if (filters.scope === 'multi_assets' && assetIds.length > 0 && !assetIds.includes(t.asset_id)) return false;
        if (operator_id !== 'all' && t.operator_id !== operator_id) return false;
        if (record_type !== 'all' && t.transaction_type !== record_type) return false;
        if (edited === 'edited' && !isEdited(t)) return false;
        if (edited === 'original' && isEdited(t)) return false;
        const asset = (state.assets || []).find(a => a.id === t.asset_id);
        if (category_id !== 'all' && asset?.category_id !== category_id) return false;
        return true;
      })
      .map(t => {
        const ft = (state.fuel_types || []).find(f => f.id === t.fuel_type_id);
        const asset = (state.assets || []).find(a => a.id === t.asset_id);
        const op = (state.operators || []).find(o => o.id === t.operator_id);
        const txLabel = FUEL_TX_TYPES[t.transaction_type] || t.transaction_type;
        return {
          ...t,
          fuel_type_name: ft?.name || '—',
          reference_no: t.reference_no ?? t.invoice_number ?? '',
          unit_snapshot: t.unit_snapshot ?? ft?.unit ?? 'لتر',
          asset_code: asset?.asset_code || 'المخزن العام',
          asset_name: asset?.name || '—',
          operator_name: op?.name || '—',
          transaction_type_label: txLabel,
          status_label: isEdited(t) ? 'معدّل' : 'أصلي',
        };
      });
  } else if (type === 'chlorine') {
    rows = (state.chlorine_transactions || [])
      .filter(t => {
        if (!inDateRange(t.transaction_date)) return false;
        if (asset_id !== 'all' && t.asset_id !== asset_id) return false;
        if (filters.scope === 'multi_assets' && assetIds.length > 0 && !assetIds.includes(t.asset_id)) return false;
        if (operator_id !== 'all' && t.operator_id !== operator_id) return false;
        if (record_type !== 'all' && t.transaction_type !== record_type) return false;
        if (edited === 'edited' && !isEdited(t)) return false;
        if (edited === 'original' && isEdited(t)) return false;
        const asset = (state.assets || []).find(a => a.id === t.asset_id);
        if (category_id !== 'all' && asset?.category_id !== category_id) return false;
        return true;
      })
      .map(t => {
        const asset = (state.assets || []).find(a => a.id === t.asset_id);
        const op = (state.operators || []).find(o => o.id === t.operator_id);
        const txLabel = CHLORINE_TX_TYPES[t.transaction_type] || t.transaction_type;
        const cat = asset ? catById.get(asset.category_id) : null;
        return {
          ...t,
          unit_snapshot: t.unit_snapshot ?? cat?.chlorine_unit ?? 'كجم',
          asset_code: asset?.asset_code || 'المخزن العام',
          asset_name: asset?.name || '—',
          operator_name: op?.name || '—',
          transaction_type_label: txLabel,
          status_label: isEdited(t) ? 'معدّل' : 'أصلي',
        };
      });
  } else if (type === 'assets') {
    rows = (state.assets || [])
      .filter(a => {
        if (category_id !== 'all' && a.category_id !== category_id) return false;
        if (asset_id !== 'all' && a.id !== asset_id) return false;
        if (status !== 'all' && a.status !== status) return false;
        if (fuel_type_id !== 'all' && a.fuel_type_id !== fuel_type_id) return false;
        return true;
      })
      .map(a => {
        const cat = (state.categories || []).find(c => c.id === a.category_id);
        const ft = (state.fuel_types || []).find(f => f.id === a.fuel_type_id);
        const dyn = {};
        for (const f of dynamicColumns) {
          const vRow = (state.asset_field_values || []).find(
            v => v.asset_id === a.id && v.field_id === f.id
          );
          dyn[`dyn_${f.field_key}`] = resolveDynValue(vRow, f);
        }
        return {
          ...a,
          category_name: cat?.name || '—',
          fuel_type_name: ft?.name || (cat?.supports_fuel ? NO_FUEL_LABEL : '—'),
          pump_capacity: a.pump_capacity ?? '',
          default_tanker_label: a.default_tanker_id
            ? tankerLabel((state.assets || []).find(x => x.id === a.default_tanker_id)) || '—'
            : '',
          effective_fuel_rate: effectiveValue(a, cat, 'fuel_rate') ?? '—',
          effective_chlorine: effectiveValue(a, cat, 'chlorine_consumption') ?? '—',
          status_label: a.status === 'active' ? 'نشط' : 'غير نشط',
          ...dyn,
        };
      });
  } else if (type === 'timeline') {
    rows = (state.timeline_events || []).filter(e => {
      if (!inDateRange(e.created_at)) return false;
      if (category_id !== 'all' && (e.category_id ?? assetById.get(e.asset_id)?.category_id) !== category_id) return false;
      if (asset_id !== 'all' && e.asset_id !== asset_id) return false;
      return true;
    }).map(e => ({ ...e, summary: e.summary ?? [e.title, e.description].filter(Boolean).join(' — ') }));
  }

  // Spec 14.4.2 / REPORT-003/006: rows from several categories -> common columns first, then the
  // report fields of every category present (labelled with the category), empty where not applicable.
  if (
    include_dynamic_fields &&
    (category_id === 'all' || !category_id) &&
    (type === 'operations' || type === 'assets') &&
    rows.length > 0
  ) {
    const rowCat = r => (type === 'assets' ? r.category_id : r.category_id ?? logCategoryId(r));
    const presentCats = new Set(rows.map(rowCat));
    const catsInOrder = [...presentCats]
      .map(id => catById.get(id))
      .filter(Boolean)
      .sort((a, b) => String(a.code_prefix || a.name).localeCompare(String(b.code_prefix || b.name)));
    const single = catsInOrder.length === 1;
    dynamicColumns = catsInOrder.flatMap(cat =>
      (state.category_fields || [])
        .filter(
          f =>
            f.category_id === cat.id &&
            f.is_active &&
            f.show_in_reports &&
            (type === 'assets' ? f.scope === 'asset' : isOpScope(f.scope))
        )
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(f =>
          single
            ? f
            : {
                ...f,
                report_key: `dyn_${f.id}`,
                report_label: `${f.label}${f.unit ? ` (${f.unit})` : ''} — ${cat.name}`,
              }
        )
    );
    const valuesFor = type === 'assets' ? state.asset_field_values || [] : logValuesAll;
    rows = rows.map(r => {
      const dyn = {};
      for (const f of dynamicColumns) {
        const key = f.report_key || `dyn_${f.field_key}`;
        if (rowCat(r) !== f.category_id) {
          dyn[key] = '';
          continue;
        }
        const vRow = valuesFor.find(v =>
          type === 'assets'
            ? v.asset_id === r.id && v.field_id === f.id
            : v.operation_log_id === r.id && v.field_id === f.id
        );
        dyn[key] = resolveDynValue(vRow, f);
      }
      return { ...r, ...dyn };
    });
  }

  const netByUnit = {};
  let fuelTotal = 0;
  let chlorineTotal = 0;
  const chlorineByUnit = {};
  let waterTotal = 0;
  let waterDistributed = 0;
  let waterNetwork = 0;

  if (type === 'operations') {
    for (const r of rows) {
      waterTotal = roundNum(waterTotal + Number(r.water_total || 0));
      waterDistributed = roundNum(waterDistributed + Number(r.distributed_quantity || 0));
      waterNetwork = roundNum(waterNetwork + Number(r.network_quantity || 0));
      const unit = r.meter_unit_snapshot || 'بلا عداد';
      netByUnit[unit] = roundNum((netByUnit[unit] || 0) + Number(r.net_operation_delta || 0));
      fuelTotal = roundNum(fuelTotal + Number(r.fuel_consumed || 0));
      chlorineTotal = roundNum(chlorineTotal + Number(r.chlorine_consumed || 0));
      if (Number(r.chlorine_consumed || 0)) {
        const cu = catById.get(r.category_id)?.chlorine_unit || 'كجم';
        chlorineByUnit[cu] = roundNum((chlorineByUnit[cu] || 0) + Number(r.chlorine_consumed));
      }
    }
  }

  const summary = {
    count: rows.length,
    net_operation_by_unit: netByUnit,
    usageByUnit: netByUnit,
    fuel_consumed_total: fuelTotal,
    totalFuelConsumed: fuelTotal,
    chlorine_consumed_total: chlorineTotal,
    totalChlorineConsumed: chlorineTotal,
    chlorine_consumed_by_unit: chlorineByUnit,
    water_total: waterTotal,
    water_distributed_total: waterDistributed,
    water_network_total: waterNetwork,
  };

  return {
    type,
    rows,
    dynamicColumns,
    dynamicColumnsMeta: dynamicColumns,
    summary,
  };
}
