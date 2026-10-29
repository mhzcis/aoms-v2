export const ROLES = Object.freeze({
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
});

export const STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

export const BACKUP_SCHEMA_VERSION = '2.0';
export const BACKUP_MAX_BYTES = 25 * 1024 * 1024;

export const FIELD_TYPES = Object.freeze(['text', 'number', 'select', 'date', 'boolean']);
export const FIELD_SCOPES = Object.freeze(['asset', 'operation']);

export const METER_UNITS = Object.freeze([
  'ساعة تشغيل',
  'كيلومتر',
  'متر مكعب',
  'دورة تشغيل',
  'عدد مرات التشغيل',
]);

export const FUEL_TX_TYPES = Object.freeze({
  supply: 'تزويد',
  adjustment_plus: 'تسوية موجبة',
  adjustment_minus: 'تسوية سالبة',
});

export const CHLORINE_TX_TYPES = Object.freeze({
  receipt: 'استلام',
  adjustment_plus: 'تسوية موجبة',
  adjustment_minus: 'تسوية سالبة',
});

export const RECORD_TYPE_LABELS = Object.freeze({
  daily: 'سجل يومي',
  meter_reset: 'تغيير عداد',
});

export const roundNum = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export const isActiveProfile = profile => !!profile && profile.status === STATUS.ACTIVE;

export const canRead = profile => {
  if (!profile) return false;
  if (typeof profile === 'string') return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER].includes(profile);
  return isActiveProfile(profile) && [ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER].includes(profile.role);
};

export const canWrite = roleOrProfile => {
  if (!roleOrProfile) return false;
  if (typeof roleOrProfile === 'string') {
    return roleOrProfile === ROLES.ADMIN || roleOrProfile === ROLES.OPERATOR;
  }
  return (
    isActiveProfile(roleOrProfile) &&
    (roleOrProfile.role === ROLES.ADMIN || roleOrProfile.role === ROLES.OPERATOR)
  );
};

export const canAdmin = roleOrProfile => {
  if (!roleOrProfile) return false;
  if (typeof roleOrProfile === 'string') return roleOrProfile === ROLES.ADMIN;
  return isActiveProfile(roleOrProfile) && roleOrProfile.role === ROLES.ADMIN;
};

export const normalizePrefix = value =>
  String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');

export const formatAssetCode = (prefix, seq) =>
  `${normalizePrefix(prefix)}-${String(Number(seq || 1)).padStart(4, '0')}`;

export const effectiveValue = (asset, category, key) => {
  const normKey = key === 'chlorine' ? 'chlorine_consumption' : key;
  const hasOverride =
    asset?.[`has_${normKey}_override`] ??
    (normKey === 'chlorine_consumption' ? asset?.has_chlorine_override : false);
  if (hasOverride) {
    return (
      asset?.[`${normKey}_override`] ??
      (normKey === 'chlorine_consumption' ? asset?.chlorine_consumption_override : null)
    );
  }
  return (
    category?.[`default_${normKey}`] ??
    (normKey === 'chlorine_consumption' ? category?.default_chlorine_consumption : null)
  );
};

export const isValidCalendarDate = str => {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
};

export const addOneDayISO = dateStr => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
};

export const nextDateISO = addOneDayISO;

export const localTodayISO = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const validateDynamicValue = (field, value, options = []) => {
  if (!field) return '';
  const isEmpty = value === '' || value === null || value === undefined;
  if (field.is_required && isEmpty) return 'الحقل مطلوب';
  if (isEmpty) return '';

  if (field.field_type === 'number') {
    if (typeof value === 'boolean' || !Number.isFinite(Number(value))) {
      return 'يجب إدخال رقم صالح';
    }
  } else if (field.field_type === 'date') {
    if (!isValidCalendarDate(String(value))) {
      return 'التاريخ غير صالح';
    }
  } else if (field.field_type === 'boolean') {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      return 'القيمة المنطقية غير صالحة';
    }
  } else if (field.field_type === 'select') {
    const fieldOpts = options.filter(o => o.field_id === field.id && o.is_active !== false);
    if (
      fieldOpts.length > 0 &&
      !fieldOpts.some(o => o.id === value || o.value_key === value || o.label === value)
    ) {
      return 'الخيار المحدد غير صالح أو غير نشط';
    }
  }
  return '';
};

export const validateCategoryInput = (input, categories = [], assets = []) => {
  const errors = {};
  const name = String(input?.name || '').trim();
  const prefix = normalizePrefix(input?.code_prefix);

  if (!name) errors.name = 'اسم التصنيف مطلوب';
  else if (
    categories.some(
      c => c.id !== input?.id && String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    )
  ) {
    errors.name = 'اسم التصنيف مستخدم مسبقًا';
  }

  if (!prefix || prefix.length < 2 || prefix.length > 6) {
    errors.code_prefix = 'اختصار التصنيف مطلوب (من 2 إلى 6 أحرف لاتينية أو أرقام)';
  }

  if (
    prefix &&
    categories.some(c => c.id !== input?.id && normalizePrefix(c.code_prefix) === prefix)
  ) {
    errors.code_prefix = 'اختصار التصنيف مستخدم مسبقًا';
  }

  if (input?.id) {
    const existing = categories.find(c => c.id === input.id);
    if (
      existing &&
      normalizePrefix(existing.code_prefix) !== prefix &&
      assets.some(a => a.category_id === existing.id)
    ) {
      errors.code_prefix = 'لا يمكن تغيير الاختصار بعد إنشاء أصول تحت هذا التصنيف';
    }
  }

  const usesMeter = Boolean(input?.uses_meter);
  if (usesMeter) {
    if (!input?.meter_unit || !METER_UNITS.includes(input.meter_unit)) {
      errors.meter_unit = 'وحدة العداد مطلوبة من القائمة المعتمدة عند تفعيل العداد';
    }
  }

  for (const rateKey of [
    'default_fuel_rate',
    'default_chlorine_consumption',
    'default_residual_chlorine',
  ]) {
    const v = input?.[rateKey];
    if (v !== undefined && v !== null && v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
      errors[rateKey] = 'القيمة يجب أن تكون رقمًا غير سالب';
    }
  }

  return errors;
};

export const validateDynamicFieldDef = (fieldInput, optionsInput = [], existingFields = []) => {
  const errors = {};
  const label = String(fieldInput?.label || '').trim();
  const key = String(fieldInput?.field_key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  const normScope = fieldInput?.scope === 'operation_log' ? 'operation' : fieldInput?.scope;

  if (!label) errors.label = 'التسمية الظاهرة مطلوبة';
  if (!key) errors.field_key = 'المفتاح الداخلي مطلوب';
  if (!FIELD_SCOPES.includes(normScope)) errors.scope = 'نطاق الحقل غير صالح';
  if (!FIELD_TYPES.includes(fieldInput?.field_type)) errors.field_type = 'نوع الحقل غير مدعوم';

  if (
    key &&
    existingFields.some(
      f =>
        f.id !== fieldInput?.id &&
        f.category_id === fieldInput?.category_id &&
        (f.scope === fieldInput?.scope || (f.scope === 'operation' && normScope === 'operation') || (f.scope === 'operation_log' && normScope === 'operation')) &&
        f.field_key === key
    )
  ) {
    errors.field_key = 'المفتاح الداخلي مكرر داخل هذا النطاق';
  }

  if (fieldInput?.id) {
    const oldField = existingFields.find(f => f.id === fieldInput.id);
    if (oldField?.has_historical_values) {
      if (oldField.field_type !== fieldInput.field_type) {
        errors.field_type = 'لا يمكن تغيير نوع الحقل بعد استخدامه في سجلات فعلية';
      }
      if (oldField.field_key !== key) {
        errors.field_key = 'لا يمكن تغيير مفتاح الحقل بعد استخدامه';
      }
    }
  }

  if (fieldInput?.field_type === 'select') {
    const activeOpts = (optionsInput || []).filter(
      o => o && o.is_active !== false && String(o.label || '').trim() !== ''
    );
    if (activeOpts.length === 0) {
      errors.options = 'القائمة المنسدلة تتطلب خيارًا نشطًا واحدًا على الأقل';
    }
  }

  return errors;
};

export const calculateFuelBalance = (
  arg1,
  arg2,
  fuelTransactions = [],
  operationLogs = [],
  fuelTypes = []
) => {
  // Support 2-arg call: calculateFuelBalance(transactionsArray, fuelTypeId)
  if (Array.isArray(arg1)) {
    const txs = arg1;
    const ftId = arg2;
    let bal = 0;
    for (const t of txs) {
      if (ftId && t.fuel_type_id !== ftId) continue;
      const q = Number(t.quantity || 0);
      if (t.transaction_type === 'supply' || t.transaction_type === 'purchase' || t.transaction_type === 'adjustment_plus') {
        bal += q;
      } else if (t.transaction_type === 'dispense' || t.transaction_type === 'adjustment_minus') {
        bal -= q;
      } else if (t.transaction_type === 'adjustment') {
        bal += q;
      }
    }
    return roundNum(bal);
  }

  const assetId = arg1;
  const fuelTypeId = arg2;
  const primaryFuelTypeId = fuelTypes[0]?.id || null;
  let totalTx = 0;
  for (const t of fuelTransactions) {
    if (assetId && t.asset_id && t.asset_id !== assetId) continue;
    if (fuelTypeId && t.fuel_type_id !== fuelTypeId) continue;
    const q = Number(t.quantity || 0);
    if (t.transaction_type === 'supply' || t.transaction_type === 'purchase' || t.transaction_type === 'adjustment_plus') {
      totalTx += q;
    } else if (t.transaction_type === 'dispense' || t.transaction_type === 'adjustment_minus') {
      totalTx -= q;
    } else if (t.transaction_type === 'adjustment') {
      totalTx += q;
    }
  }

  let totalConsumed = 0;
  for (const log of operationLogs) {
    if (assetId && log.asset_id !== assetId) continue;
    const logFuelType = log.fuel_type_id || primaryFuelTypeId;
    if (!fuelTypeId || !logFuelType || logFuelType === fuelTypeId) {
      totalConsumed += Number(log.fuel_consumed || 0);
    }
  }

  return roundNum(totalTx - totalConsumed);
};

export const calculateChlorineBalance = (
  arg1,
  chlorineTransactions = [],
  operationLogs = []
) => {
  // Support 1-arg call: calculateChlorineBalance(transactionsArray)
  if (Array.isArray(arg1)) {
    let bal = 0;
    for (const t of arg1) {
      const q = Number(t.quantity || 0);
      if (t.transaction_type === 'receipt' || t.transaction_type === 'purchase' || t.transaction_type === 'adjustment_plus') {
        bal += q;
      } else if (t.transaction_type === 'dispense' || t.transaction_type === 'adjustment_minus') {
        bal -= q;
      } else if (t.transaction_type === 'adjustment') {
        bal += q;
      }
    }
    return roundNum(bal);
  }

  const assetId = arg1;
  let totalTx = 0;
  for (const t of chlorineTransactions) {
    if (assetId && t.asset_id && t.asset_id !== assetId) continue;
    const q = Number(t.quantity || 0);
    if (t.transaction_type === 'receipt' || t.transaction_type === 'purchase' || t.transaction_type === 'adjustment_plus') {
      totalTx += q;
    } else if (t.transaction_type === 'dispense' || t.transaction_type === 'adjustment_minus') {
      totalTx -= q;
    } else if (t.transaction_type === 'adjustment') {
      totalTx += q;
    }
  }

  let totalConsumed = 0;
  for (const log of operationLogs) {
    if (assetId && log.asset_id !== assetId) continue;
    totalConsumed += Number(log.chlorine_consumed || 0);
  }

  return roundNum(totalTx - totalConsumed);
};

const getLogDate = l => String(l?.operation_date || l?.log_date || '');

export const latestOperationLog = (operationLogs = [], assetId) => {
  const sorted = (operationLogs || [])
    .filter(l => !assetId || l.asset_id === assetId)
    .sort(
      (a, b) =>
        getLogDate(b).localeCompare(getLogDate(a)) ||
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
  return sorted[0] || null;
};

export const previousOperationLog = (operationLogs = [], assetId, excludeId = null) => {
  const sorted = (operationLogs || [])
    .filter(l => (!assetId || l.asset_id === assetId) && l.id !== excludeId)
    .sort(
      (a, b) =>
        getLogDate(b).localeCompare(getLogDate(a)) ||
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
  return sorted[0] || null;
};

export const latestFuelTransaction = (fuelTransactions = [], fuelTypeId = null, assetId = null) => {
  const sorted = (fuelTransactions || [])
    .filter(t => (!fuelTypeId || t.fuel_type_id === fuelTypeId) && (!assetId || t.asset_id === assetId))
    .sort(
      (a, b) =>
        String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')) ||
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
  return sorted[0] || null;
};

export const latestChlorineTransaction = (chlorineTransactions = [], assetId = null) => {
  const sorted = (chlorineTransactions || [])
    .filter(t => !assetId || t.asset_id === assetId)
    .sort(
      (a, b) =>
        String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')) ||
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
  return sorted[0] || null;
};

export const getOperationDateRule = (
  operationLogs = [],
  assetId,
  category = null,
  excludeLogId = null,
  today = localTodayISO()
) => {
  const prev = previousOperationLog(operationLogs, assetId, excludeLogId);
  if (!prev) {
    return {
      prev: null,
      min: '',
      max: today,
      blocked: false,
      blockedToday: false,
      reason: '',
      defaultDate: today,
    };
  }

  const min = addOneDayISO(getLogDate(prev));
  const blocked = min > today;
  return {
    prev,
    min: category?.uses_meter !== false ? min : '',
    max: today,
    blocked,
    blockedToday: blocked,
    reason: blocked ? 'تم تسجيل سجل اليوم لهذا الأصل، لا يمكن إضافة سجل جديد قبل اليوم التالي' : '',
    defaultDate: blocked ? '' : min,
  };
};

// ---------------------------------------------------------------------------
// Single fuel tank per asset + pump water / tanker distribution (migration 005)
// ---------------------------------------------------------------------------
export const ASSET_KINDS = Object.freeze({ general: 'عام', pump: 'مضخة', tanker: 'صهريج' });
export const NO_FUEL_LABEL = 'بدون وقود';

export const assetKind = category => (category?.asset_kind && ASSET_KINDS[category.asset_kind] ? category.asset_kind : 'general');

/** The one tank of an asset: its fuel type id, or null when the asset is «بدون وقود». */
export const getAssetTank = asset => asset?.fuel_type_id || null;

/** Consumption = operating hours × fuel per hour recorded on the asset card (or category default). */
export const calcTankConsumption = (hours, fuelPerHour) => {
  const h = Number(hours || 0);
  const r = Number(fuelPerHour || 0);
  if (!(h > 0) || !(r > 0)) return 0;
  return roundNum(h * r);
};

/** Pumped water (m³) = (end − start) × pump capacity (m³/hour). */
export const calcPumpWater = (startReading, endReading, capacity) => {
  const s = Number(startReading);
  const e = Number(endReading);
  const c = Number(capacity);
  if (!Number.isFinite(s) || !Number.isFinite(e) || !(c > 0) || e < s) return 0;
  return roundNum((e - s) * c);
};

/** Network quantity = total water − quantity distributed by tankers. */
export const calcNetwork = (waterTotal, distributed) => roundNum(Number(waterTotal || 0) - Number(distributed || 0));

/** Validation for the pump/tanker part of a log. Returns an array of Arabic messages. */
export const validatePumpLog = ({ waterTotal = 0, tripsCount = 0, distributed = 0, tankerId = null } = {}) => {
  const errors = [];
  const t = Number(tripsCount || 0);
  const d = Number(distributed || 0);
  if (!Number.isInteger(t) || t < 0) errors.push('عدد النقلات يجب أن يكون عددًا صحيحًا موجبًا أو صفرًا');
  if (!Number.isFinite(d) || d < 0) errors.push('الكمية الموزعة لا يمكن أن تكون سالبة');
  if (d > roundNum(waterTotal) + 1e-9) errors.push(`الكمية الموزعة (${d}) لا يمكن أن تتجاوز إجمالي المياه (${roundNum(waterTotal)})`);
  if ((t > 0 || d > 0) && !tankerId) errors.push('يجب اختيار الصهريج عند تسجيل نقلات أو كمية موزعة');
  return errors;
};

/** Balance of the asset's single tank: refills ± adjustments − consumption (logs of this asset). */
export const calculateTankBalance = (asset, fuelTransactions = [], operationLogs = []) => {
  const tank = getAssetTank(asset);
  if (!asset || !tank) return { tank: null, supplied: 0, adjustedPlus: 0, adjustedMinus: 0, consumed: 0, balance: 0 };
  let supplied = 0; let adjustedPlus = 0; let adjustedMinus = 0; let consumed = 0;
  for (const t of fuelTransactions) {
    if (t.asset_id !== asset.id || t.fuel_type_id !== tank) continue;
    const q = Number(t.quantity || 0);
    if (t.transaction_type === 'supply' || t.transaction_type === 'purchase') supplied += q;
    else if (t.transaction_type === 'adjustment_plus' || t.transaction_type === 'adjustment') adjustedPlus += q;
    else if (t.transaction_type === 'adjustment_minus' || t.transaction_type === 'dispense') adjustedMinus += q;
  }
  for (const l of operationLogs) {
    if (l.asset_id !== asset.id) continue;
    if (l.fuel_type_id && l.fuel_type_id !== tank) continue;
    consumed += Number(l.fuel_consumed || 0);
  }
  return {
    tank,
    supplied: roundNum(supplied),
    adjustedPlus: roundNum(adjustedPlus),
    adjustedMinus: roundNum(adjustedMinus),
    consumed: roundNum(consumed),
    balance: roundNum(supplied + adjustedPlus - adjustedMinus - consumed),
  };
};

export const tankerLabel = tanker => (tanker ? `صهريج: ${tanker.name || tanker.asset_code || ''}` : '');
