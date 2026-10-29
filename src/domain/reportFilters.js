import { isValidISODate } from '../utils/dates.js';

export const REPORT_SCOPE_LABELS = Object.freeze({
  all_assets: 'جميع الأصول', category: 'تصنيف كامل', asset: 'أصل واحد', multi_assets: 'مجموعة أصول مختارة',
});
export const REPORT_EVENT_LABELS = Object.freeze({
  operation: 'سجلات التشغيل', operations: 'سجلات التشغيل', fuel: 'حركات الوقود',
  chlorine: 'حركات الكلور', all: 'جميع الأحداث', events: 'جميع الأحداث', assets: 'الأصول', timeline: 'الخط الزمني',
});

export function reportFilterError(state, f = {}) {
  if (f.from && !isValidISODate(f.from)) return 'تاريخ البداية غير صالح';
  if (f.to && !isValidISODate(f.to)) return 'تاريخ النهاية غير صالح';
  if (f.from && f.to && f.from > f.to) return 'تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه';
  const assets = state.assets || [];
  if (f.scope === 'asset' && !assets.some(a => a.id === (f.assetId || f.asset_id))) return 'اختر أصلًا لعرض التقرير';
  if (f.scope === 'category' && !(state.categories || []).some(c => c.id === (f.categoryId || f.category_id))) return 'اختر تصنيفًا لعرض التقرير';
  if (f.scope === 'multi_assets' && (!Array.isArray(f.assetIds) || !f.assetIds.length || f.assetIds.some(id => !assets.some(a => a.id === id)))) return 'اختر أصلًا واحدًا على الأقل من القائمة';
  if (f.scope && !REPORT_SCOPE_LABELS[f.scope]) return 'نطاق التقرير غير صالح';
  return '';
}

export function describeReportFilters(state, f = {}) {
  const assetName = id => {
    const a = (state.assets || []).find(x => x.id === id);
    return a ? `${a.asset_code} | ${a.name}` : id;
  };
  const cat = (state.categories || []).find(x => x.id === (f.categoryId || f.category_id));
  const op = (state.operators || []).find(x => x.id === (f.operatorId || f.operator_id));
  const ft = (state.fuel_types || []).find(x => x.id === (f.fuelTypeId || f.fuel_type_id));
  const parts = [`النطاق: ${REPORT_SCOPE_LABELS[f.scope] || 'جميع الأصول'}`];
  if (f.scope === 'asset') parts.push(`الأصل: ${assetName(f.assetId || f.asset_id)}`);
  if (f.scope === 'category' && cat) parts.push(`التصنيف: ${cat.code_prefix} | ${cat.name}`);
  if (f.scope === 'multi_assets') parts.push(`الأصول: ${(f.assetIds || []).map(assetName).join('، ')}`);
  parts.push(`الفترة: ${f.from || 'البداية'} ← ${f.to || 'الآن'}`);
  parts.push(`نوع الحدث: ${REPORT_EVENT_LABELS[f.type || f.eventType] || 'سجلات التشغيل'}`);
  parts.push(`المشغل: ${op?.name || 'الكل'}`);
  if (ft) parts.push(`الوقود: ${ft.name}`);
  return parts.join(' — ');
}
