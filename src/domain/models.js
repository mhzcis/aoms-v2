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
export const FIELD_SCOPES = Object.freeze(['asset', 'operation', 'operation_log']);

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

export const localTodayISO = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

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
  if (!FIELD_SCOPES.includes(fieldInput?.scope)) errors.scope = 'نطاق الحقل غير صالح';
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
