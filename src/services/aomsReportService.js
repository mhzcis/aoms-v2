import ExcelJS from 'exceljs';
import { loadAmiriFonts } from '../assets/fonts/amiriFontData';
import { niceDate, stamp, todayArabic } from '../utils/dates';

const BRAND = {
  tealDark: 'FF0F766E',
  tealDeep: 'FF115E59',
  tealSoft: 'FFF0FDFA',
  slateText: 'FF0F172A',
  slateMuted: 'FF475569',
  border: 'FFCBD5E1',
  zebra: 'FFF8FAFC',
};

const PDF_RGB = {
  tealDark: [15, 118, 110],
  tealDeep: [17, 94, 89],
  tealSoft: [240, 253, 250],
  slateText: [15, 23, 42],
  slateMuted: [71, 85, 105],
  border: [203, 213, 225],
  zebra: [248, 250, 252],
};

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
      { key: 'chlorine_consumed', label: 'الكلور المستهلك' },
      { key: 'residual_chlorine', label: 'الكلور المتبقي' },
      { key: 'status_label', label: 'الحالة' },
      { key: 'notes', label: 'الملاحظات' },
      ...dynCols,
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
      { key: 'fuel_type_name', label: 'نوع الوقود' },
      { key: 'effective_fuel_rate', label: 'معدل الوقود الفعال' },
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
  if (byUnit) parts.push(`صافي التشغيل حسب الوحدة: ${byUnit}`);
  if (summary.fuel_consumed_total) parts.push(`إجمالي الوقود المستهلك: ${summary.fuel_consumed_total}`);
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

export function exportAomsCSV(report, title = 'تقرير AOMS V2') {
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
  const csvContent = '\uFEFF' + [escapeCsv(title), summaryLine, header, ...lines].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  return triggerDownload(blob, `aoms-report-${report.type}-${stamp()}.csv`);
}

export async function exportAomsExcel(report, title = 'تقرير نظام إدارة وتشغيل الأصول والمعدات', filtersSummary = 'الكل') {
  const cols = getAomsReportColumns(report.type, report.dynamicColumns);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AOMS V2 — م. محمد أبو زهري';
  wb.created = new Date();

  const ws = wb.addWorksheet('التقرير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
  });

  const colCount = Math.max(cols.length, 4);
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: 'Tajawal', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.tealDark } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, colCount);
  const metaCell = ws.getCell(2, 1);
  metaCell.value = `تاريخ التصدير: ${todayArabic()} | الفلاتر: ${filtersSummary}`;
  metaCell.font = { name: 'Tajawal', size: 10, bold: true, color: { argb: BRAND.slateText } };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.tealSoft } };
  metaCell.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(2).height = 22;

  ws.mergeCells(3, 1, 3, colCount);
  const sumCell = ws.getCell(3, 1);
  sumCell.value = formatUsageSummaryText(report.summary);
  sumCell.font = { name: 'Tajawal', size: 10, bold: true, color: { argb: BRAND.tealDeep } };
  sumCell.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(3).height = 22;

  const headerRow = ws.getRow(4);
  cols.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = c.label;
    cell.font = { name: 'Tajawal', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.tealDeep } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 25;

  (report.rows || []).forEach((r, rIdx) => {
    const row = ws.getRow(5 + rIdx);
    cols.forEach((c, cIdx) => {
      const raw = r[c.key];
      const val = c.format ? c.format(raw, r) : raw;
      const cell = row.getCell(cIdx + 1);
      cell.value = val === null || val === undefined || val === '' ? '—' : val;
      cell.font = { name: 'Tajawal', size: 10, color: { argb: BRAND.slateText } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      if (rIdx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.zebra } };
      }
    });
  });

  ws.columns.forEach(col => {
    col.width = 18;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `aoms-report-${report.type}-${stamp()}.xlsx`);
  return wb;
}

// REPORT-011: jsPDF's bidi engine must treat input as *logical* RTL text and
// mirror brackets. Without this, autotable cells (which pass isInputVisual:false
// by default) render Arabic letters in reverse order, and header lines that mix
// Arabic, numbers and parentheses come out with misplaced/mirrored brackets.
export const PDF_RTL_TEXT_OPTIONS = Object.freeze({
  isInputVisual: false,
  isInputRtl: true,
  isOutputVisual: true,
  isOutputRtl: false,
  isSymmetricSwapping: true,
});

export async function exportAomsPDF(report, title = 'تقرير نظام إدارة وتشغيل الأصول والمعدات', filtersSummary = 'الكل', fonts = null) {
  const cols = getAomsReportColumns(report.type, report.dynamicColumns);
  const [{ jsPDF }, { default: autoTable }, { amiriRegular, amiriBold }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    fonts ? Promise.resolve(fonts) : loadAmiriFonts(),
  ]);
  const doc = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });
  doc.addFileToVFS('Amiri-Regular.ttf', amiriRegular);
  doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
  doc.addFileToVFS('Amiri-Bold.ttf', amiriBold);
  doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold');
  doc.setFont('Amiri', 'bold');

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_RGB.tealDark);
  doc.rect(0, 0, pageWidth, 54, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(title, pageWidth - 28, 32, { align: 'right', ...PDF_RTL_TEXT_OPTIONS });

  doc.setTextColor(...PDF_RGB.slateText);
  doc.setFont('Amiri', 'normal');
  doc.setFontSize(10);
  doc.text(`تاريخ التصدير: ${todayArabic()} | الفلاتر: ${filtersSummary}`, pageWidth - 28, 72, { align: 'right', ...PDF_RTL_TEXT_OPTIONS });
  doc.setFont('Amiri', 'bold');
  doc.text(formatUsageSummaryText(report.summary), pageWidth - 28, 90, { align: 'right', ...PDF_RTL_TEXT_OPTIONS });

  const reversedCols = [...cols].reverse();
  const head = [reversedCols.map(c => c.label)];
  const body = (report.rows || []).map(r =>
    reversedCols.map(c => {
      const raw = r[c.key];
      const val = c.format ? c.format(raw, r) : raw;
      return val === null || val === undefined || val === '' ? '—' : String(val);
    })
  );

  // REPORT-011 (responsive): wide operations reports have 15+ columns on one A4 page. Give every column
  // at least the width of its longest single word so autotable wraps between words, never inside one.
  const FONT_SIZE = 8;
  const PADDING = 3;
  doc.setFontSize(FONT_SIZE);
  // jsPDF's splitTextToSize (used by autotable) measures Arabic wider than getTextWidth, so find each
  // word's one-line width with the splitter itself (binary search, cached per font style).
  const wordWidthCache = new Map();
  const oneLineWidth = word => {
    let lo = doc.getTextWidth(word);
    let hi = lo * 3 + 1;
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2;
      if (doc.splitTextToSize(word, mid).length > 1) lo = mid; else hi = mid;
    }
    return hi;
  };
  const longestWord = (texts, style) => {
    doc.setFont('Amiri', style);
    let w = 0;
    for (const t of texts) {
      for (const word of String(t).split(/\s+/)) {
        if (!word) continue;
        const k = `${style}|${word}`;
        if (!wordWidthCache.has(k)) wordWidthCache.set(k, oneLineWidth(word));
        w = Math.max(w, wordWidthCache.get(k));
      }
    }
    return w;
  };
  const columnStyles = {};
  reversedCols.forEach((_, i) => {
    const minWord = Math.max(longestWord([head[0][i]], 'bold'), longestWord(body.map(r => r[i]), 'normal'));
    columnStyles[i] = { minCellWidth: Math.min(minWord + 2 * PADDING + 0.5, 90) };
  });
  doc.setFont('Amiri', 'normal');

  autoTable(doc, {
    startY: 104,
    margin: { left: 20, right: 20 },
    head,
    body,
    columnStyles,
    styles: {
      font: 'Amiri',
      fontSize: FONT_SIZE,
      halign: 'right',
      cellPadding: PADDING,
      textColor: PDF_RGB.slateText,
      textOptions: { ...PDF_RTL_TEXT_OPTIONS },
    },
    headStyles: {
      font: 'Amiri',
      fontStyle: 'bold',
      fillColor: PDF_RGB.tealDeep,
      textColor: [255, 255, 255],
      halign: 'right',
    },
    alternateRowStyles: {
      fillColor: PDF_RGB.zebra,
    },
  });

  if (typeof window !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    doc.save(`aoms-report-${report.type}-${stamp()}.pdf`);
  }
  return doc;
}
