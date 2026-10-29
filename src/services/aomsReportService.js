import { prepareReportExport } from '../domain/reportExportModel';
import { writeExcel, writePDF } from './reportExportWriters';
import { businessDateTime } from '../utils/businessTime';
import { niceDate, stamp } from '../utils/dates';

export function getAomsReportColumns(typeOrDynCols = 'operations', dynamicColumns = []) {
  const type = Array.isArray(typeOrDynCols) ? 'operations' : (typeOrDynCols || 'operations');
  if (Array.isArray(typeOrDynCols)) dynamicColumns = typeOrDynCols;
  const dynCols = (dynamicColumns || []).map(f => ({
    key: f.report_key || `dyn_${f.field_key}`,
    label: f.report_label || (f.unit ? `${f.label} (${f.unit})` : f.label),
  }));

  if (type === 'operations') {
    return [
      { key: 'log_date', label: 'التاريخ', format: v => niceDate(v) },
      { key: 'asset_code', label: 'رمز الأصل' },
      { key: 'asset_name', label: 'اسم الأصل' },
      { key: 'category_name', label: 'التصنيف' },
      { key: 'operator_name', label: 'المشغل' },
      { key: 'record_type_label', label: 'نوع السجل' },
      { key: 'previous_reading', label: 'القراءة السابقة' },
      { key: 'current_reading', label: 'القراءة الحالية' },
      { key: 'net_operation_delta', label: 'صافي التشغيل' },
      { key: 'meter_unit_snapshot', label: 'الوحدة' },
      { key: 'fuel_consumed', label: 'الوقود المستهلك' },
      { key: 'fuel_consumed_unit', label: 'وحدة استهلاك الوقود' },
      { key: 'water_total', label: 'إجمالي المياه (م³)' },
      { key: 'tanker_label', label: 'الصهريج' },
      { key: 'trips_count', label: 'عدد النقلات' },
      { key: 'distributed_quantity', label: 'الكمية الموزعة (م³)' },
      { key: 'network_quantity', label: 'كمية الشبكة (م³)' },
      { key: 'chlorine_consumed', label: 'الكلور المستهلك' },
      { key: 'chlorine_consumed_unit', label: 'وحدة استهلاك الكلور' },
      { key: 'residual_chlorine', label: 'الكلور المتبقي' },
      { key: 'status_label', label: 'الحالة' },
      { key: 'notes', label: 'الملاحظات' },
      ...dynCols,
    ];
  }
  if (type === 'events') {
    const op = getAomsReportColumns('operations', dynamicColumns).filter(c => c.key !== 'log_date');
    const tx = getAomsReportColumns('fuel').filter(c => ['fuel_type_name', 'transaction_type_label', 'quantity', 'unit_snapshot', 'reference_no'].includes(c.key));
    return [
      { key: 'event_date', label: 'التاريخ', format: v => niceDate(v) },
      { key: 'event_type_label', label: 'نوع الحدث' }, ...op, ...tx,
    ];
  }
  if (type === 'fuel') {
    return [
      { key: 'transaction_date', label: 'التاريخ', format: v => niceDate(v) },
      { key: 'fuel_type_name', label: 'نوع الوقود' },
      { key: 'transaction_type_label', label: 'نوع الحركة' },
      { key: 'quantity', label: 'الكمية' },
      { key: 'unit_snapshot', label: 'الوحدة' },
      { key: 'asset_code', label: 'الأصل المستفيد' },
      { key: 'operator_name', label: 'المشغل' },
      { key: 'reference_no', label: 'المرجع' },
      { key: 'status_label', label: 'الحالة' },
      { key: 'notes', label: 'الملاحظات' },
    ];
  }
  if (type === 'chlorine') {
    return [
      { key: 'transaction_date', label: 'التاريخ', format: v => niceDate(v) },
      { key: 'transaction_type_label', label: 'نوع الحركة' },
      { key: 'quantity', label: 'الكمية' },
      { key: 'unit_snapshot', label: 'الوحدة' },
      { key: 'residual_chlorine', label: 'الكلور المتبقي' },
      { key: 'asset_code', label: 'الأصل المستفيد' },
      { key: 'operator_name', label: 'المشغل' },
      { key: 'reference_no', label: 'المرجع' },
      { key: 'status_label', label: 'الحالة' },
      { key: 'notes', label: 'الملاحظات' },
    ];
  }
  if (type === 'assets') {
    return [
      { key: 'asset_code', label: 'رمز الأصل' },
      { key: 'name', label: 'اسم الأصل' },
      { key: 'category_name', label: 'التصنيف' },
      { key: 'location', label: 'الموقع' },
      { key: 'status_label', label: 'الحالة' },
      { key: 'fuel_type_name', label: 'خزان الوقود (نوع الوقود)' },
      { key: 'effective_fuel_rate', label: 'معدل الوقود الفعال' },
      { key: 'pump_capacity', label: 'قدرة المضخة (م³/ساعة)' },
      { key: 'default_tanker_label', label: 'الصهريج الافتراضي' },
      { key: 'effective_chlorine', label: 'معدل الكلور الفعال' },
      { key: 'notes', label: 'الملاحظات' },
      ...dynCols,
    ];
  }
  return [
    { key: 'created_at', label: 'الوقت', format: v => (v ? String(v).slice(0, 19).replace('T', ' ') : '—') },
    { key: 'event_type', label: 'نوع الحدث' },
    { key: 'entity_type', label: 'الكيان' },
    { key: 'summary', label: 'الملخص' },
  ];
}

export function formatUsageSummaryText(summaryOrMap = {}) {
  const summary =
    summaryOrMap && summaryOrMap.net_operation_by_unit
      ? summaryOrMap
      : { count: 0, net_operation_by_unit: summaryOrMap || {} };
  const byUnit = Object.entries(summary.net_operation_by_unit || {})
    .map(([u, v]) => `${v} (${u})`)
    .join(' | ');
  const parts = [`إجمالي السجلات: ${summary.count || 0}`];
  if (summary.event_counts) parts.push(`تشغيل: ${summary.event_counts.operations || 0} • وقود: ${summary.event_counts.fuel || 0} • كلور: ${summary.event_counts.chlorine || 0}`);
  if (byUnit) parts.push(`صافي التشغيل حسب الوحدة: ${byUnit}`);
  const fuelUnits = Object.entries(summary.fuel_consumed_by_unit || {});
  if (fuelUnits.length) parts.push(`الوقود المستهلك حسب الوحدة: ${fuelUnits.map(([u, v]) => `${v} (${u})`).join(' | ')}`);
  else if (summary.fuel_consumed_total) parts.push(`إجمالي الوقود المستهلك: ${summary.fuel_consumed_total}`);
  if (summary.water_total) {
    parts.push(
      `إجمالي المياه: ${summary.water_total} م³ (صهاريج: ${summary.water_distributed_total || 0} م³ • شبكة: ${summary.water_network_total || 0} م³)`
    );
  }
  const chlUnits = Object.entries(summary.chlorine_consumed_by_unit || {});
  if (chlUnits.length > 1) {
    // different chlorine units are never added into one number (REPORT-007)
    parts.push(`الكلور المستهلك حسب الوحدة: ${chlUnits.map(([u, v]) => `${v} (${u})`).join(' | ')}`);
  } else if (chlUnits.length === 1) {
    parts.push(`إجمالي الكلور المستهلك: ${chlUnits[0][1]} (${chlUnits[0][0]})`);
  } else if (summary.chlorine_consumed_total) {
    parts.push(`إجمالي الكلور المستهلك: ${summary.chlorine_consumed_total}`);
  }
  return parts.join(' — ');
}

const triggerDownload = (blob, filename) => {
  if (typeof URL?.createObjectURL !== 'function' || typeof document === 'undefined') return true;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
};

export function exportAomsCSV(report, title = 'تقرير إدارة وتشغيل الأصول والمعدات') {
  if (report.valid === false) throw new Error(report.filterError || 'أكمل فلاتر التقرير أولًا');
  const cols = getAomsReportColumns(report.type, report.dynamicColumns);
  const escapeCsv = val => {
    let s = val === null || val === undefined || val === '' ? '—' : String(val);
    // CSV/formula injection (REPORT-010): text starting with = + - @ TAB CR is neutralised with a leading '
    if (typeof val === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = cols.map(c => escapeCsv(c.label)).join(',');
  const lines = (report.rows || []).map(row =>
    cols
      .map(c => {
        const raw = row[c.key];
        const formatted = c.format ? c.format(raw, row) : raw;
        return escapeCsv(formatted);
      })
      .join(',')
  );
  const summaryLine = escapeCsv(formatUsageSummaryText(report.summary));
  const csvContent = '\uFEFF' + [escapeCsv(`${title} — ${report.filtersSummary || 'الفلاتر: الكل'} — وقت التصدير: ${businessDateTime(new Date(), report.timeZone)} (${report.timeZone || 'Asia/Jerusalem'})`), summaryLine, header, ...lines].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  return triggerDownload(blob, `aoms-report-${report.type}-${stamp()}.csv`);
}

export async function exportAomsExcel(report, title = 'تقرير إدارة وتشغيل الأصول والمعدات', filtersSummary = report.filtersSummary || 'الكل', options = {}) {
  return writeExcel(prepareReportExport({...report,filtersSummary}, getAomsReportColumns(report.type, report.dynamicColumns), options), title);
}
export { PDF_RTL_TEXT_OPTIONS } from './reportExportWriters';
export async function exportAomsPDF(report, title = 'تقرير إدارة وتشغيل الأصول والمعدات', filtersSummary = report.filtersSummary || 'الكل', fonts = null, options = {}) {
  return writePDF(prepareReportExport({...report,filtersSummary}, getAomsReportColumns(report.type, report.dynamicColumns), {...options,format:'pdf'}), title, fonts);
}
