import { niceDate, stamp } from '../utils/dates';
import { RECORD_TYPES } from '../data/defaultData';
import { roundHours, sortLogs } from '../utils/calculations';
import { attachTajawalFonts, tajawalFontFaceCss } from '../fonts';

const labels = {
  date: 'التاريخ',
  day: 'اليوم',
  generatorNumber: 'رقم المولد',
  generatorName: 'اسم المولد',
  location: 'الموقع',
  recordTypeLabel: 'نوع السجل',
  previousReading: 'القراءة السابقة',
  currentReading: 'القراءة الحالية',
  operatingHours: 'ساعات التشغيل',
  notes: 'الملاحظات',
};

export const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const sanitizeCsvCell = value => {
  const str = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const buildCSV = (data, columns) => {
  const activeCols = Array.isArray(columns) && columns.length ? columns : Object.keys(labels);
  const headerLine = activeCols.map(c => sanitizeCsvCell(labels[c])).join(',');
  const bodyLines = data.map(r => activeCols.map(c => sanitizeCsvCell(r[c] ?? '')).join(','));
  return '\ufeff' + [headerLine, ...bodyLines].join('\r\n');
};

export const enrich = (logs, generators) => {
  const genMap = new Map((generators || []).map(g => [g.id, g]));
  return (logs || []).map(x => {
    const g = genMap.get(x.generatorId) || {};
    return {
      ...x,
      generatorNumber: g.number || '',
      generatorName: g.name || '',
      location: g.location || '',
      latitude: g.latitude ?? '',
      longitude: g.longitude ?? '',
      recordTypeLabel: x.recordType === 'daily' ? 'سجل يومي' : 'تغيير عداد',
    };
  });
};

// ترتيب سجلات التقرير: 'newest' (الأحدث أولًا، الافتراضي) أو 'oldest' (الأقدم أولًا).
export const REPORT_ORDERS = { newest: 'الأحدث أولًا', oldest: 'الأقدم أولًا' };
export const orderReportData = (data, order = 'newest') => {
  const sorted = sortLogs(data || []);
  return order === 'oldest' ? sorted.reverse() : sorted;
};

// حساب ملخص إحصائي فوري للبيانات المفلترة في تمريرة واحدة عالية الكفاءة O(N)
export const summarizeReportData = data => {
  const generatorKeys = new Set();
  let totalOperatingHours = 0;
  let dailyCount = 0;
  let meterResetCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    totalOperatingHours += Number(row.operatingHours || 0);
    if (row.generatorId || row.generatorNumber) {
      generatorKeys.add(row.generatorId || row.generatorNumber);
    }
    if (row.recordType === 'meterReset' || row.recordTypeLabel === 'تغيير عداد') {
      meterResetCount++;
    } else {
      dailyCount++;
    }
  }

  return {
    count: data.length,
    totalHours: roundHours(totalOperatingHours),
    uniqueGenerators: generatorKeys.size,
    dailyCount,
    meterResetCount,
  };
};

// هوية لونية حديثة لتقارير Excel (متوافقة مع الهوية البصرية الزمردية والكهرمانية للتطبيق)
const XL = {
  primary: 'FF0F766E',
  dark: 'FF115E59',
  accent: 'FFF59E0B',
  metaFill: 'FFECFDF5',
  metaCountFill: 'FFE0F2FE',
  metaFilterFill: 'FFFEF3C7',
  zebra: 'FFF4F7FB',
  hoursFill: 'FFF0FDFA',
  hoursText: 'FF0F766E',
  dailyFill: 'FFDCFCE7',
  dailyText: 'FF166534',
  resetFill: 'FFFEF3C7',
  resetText: 'FFB45309',
  border: 'FFCBD5E1',
  text: 'FF0F172A',
  mutedText: 'FF334155',
  white: 'FFFFFFFF',
};

const NUMERIC = ['previousReading', 'currentReading', 'operatingHours'];
const thin = { style: 'thin', color: { argb: XL.border } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };
const numFmt = v => (Number.isInteger(Number(v)) ? '#,##0' : '#,##0.0#');

const cellValue = (r, c) => {
  const v = r[c] ?? '';
  if (c === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  if (NUMERIC.includes(c) && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return v;
};

const displayLength = (r, c) => (c === 'date' ? 10 : String(r[c] ?? '').length);

// الخط العربي العصري المعتمد في الهوية الجديدة للتطبيق والتقارير
export const EXCEL_FONT = 'Tajawal';
export const REPORT_FONT_STACK = '"Tajawal", "Cairo", "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif';
export const EXCEL_SHEET_NAME = 'تقرير التشغيل';
export const EXCEL_HEADER_ROW = 5;

export function buildExcelWorkbook(
  ExcelJS,
  data,
  columns,
  { filtersText = '', createdAt = new Date() } = {}
) {
  const activeCols = Array.isArray(columns) && columns.length ? columns : Object.keys(labels);
  const summary = summarizeReportData(data);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'نظام متابعة تشغيل المولدات';
  wb.created = createdAt;
  const n = activeCols.length;
  const H = EXCEL_HEADER_ROW;

  const ws = wb.addWorksheet(EXCEL_SHEET_NAME, {
    views: [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: H, activeCell: `A${H + 1}` }],
    properties: { defaultRowHeight: 22 },
    pageSetup: {
      paperSize: 9,
      orientation: n > 6 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: `${H}:${H}`,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&Cصفحة &P من &N' },
  });

  const meta = [
    ['تقرير تشغيل المولدات'],
    [
      `تاريخ ووقت الإنشاء: ${createdAt.toLocaleString('ar', {
        dateStyle: 'full',
        timeStyle: 'short',
      })}   |   إجمالي ساعات التشغيل: ${summary.totalHours} ساعة`,
    ],
    [`عدد النتائج: ${data.length}`],
    [`الفلاتر المطبقة: ${filtersText || 'لا يوجد'}`],
  ];

  meta.forEach(([text], i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = text;
    if (n > 1) ws.mergeCells(i + 1, 1, i + 1, n);
    const cell = row.getCell(1);

    if (i === 0) {
      row.height = 38;
      cell.font = { name: EXCEL_FONT, size: 18, bold: true, color: { argb: XL.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
      cell.border = { bottom: { style: 'medium', color: { argb: XL.accent } } };
    } else {
      row.height = i === 3 ? Math.max(24, Math.ceil(text.length / Math.max(20, n * 14)) * 18) : 24;
      const bgArgb = i === 1 ? XL.metaFill : i === 2 ? XL.metaCountFill : filtersText ? XL.metaFilterFill : XL.zebra;
      cell.font = { name: EXCEL_FONT, size: 11, bold: i < 3, color: { argb: XL.text } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      cell.alignment = {
        horizontal: 'right',
        vertical: 'middle',
        wrapText: true,
        readingOrder: 'rtl',
        indent: 1,
      };
      cell.border = allBorders;
    }
  });

  const head = ws.getRow(H);
  head.height = 30;
  activeCols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = labels[c];
    cell.font = { name: EXCEL_FONT, size: 11, bold: true, color: { argb: XL.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.dark } };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
      readingOrder: 'rtl',
    };
    cell.border = { ...allBorders, bottom: { style: 'medium', color: { argb: XL.accent } } };
  });

  for (let ri = 0; ri < data.length; ri++) {
    const r = data[ri];
    const row = ws.getRow(H + 1 + ri);
    row.height = 22;
    const isOdd = ri % 2 === 1;

    for (let ci = 0; ci < activeCols.length; ci++) {
      const c = activeCols[ci];
      const cell = row.getCell(ci + 1);
      const v = cellValue(r, c);
      cell.value = v;
      cell.border = allBorders;

      // تنسيق شرطي ملون وحديث حسب نوع العمود وقيمته
      if (c === 'recordTypeLabel') {
        const isReset = r.recordType === 'meterReset' || v === 'تغيير عداد';
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isReset ? XL.resetFill : XL.dailyFill },
        };
        cell.font = {
          name: EXCEL_FONT,
          size: 10,
          bold: true,
          color: { argb: isReset ? XL.resetText : XL.dailyText },
        };
      } else if (c === 'operatingHours') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isOdd ? XL.zebra : XL.hoursFill },
        };
        cell.font = {
          name: EXCEL_FONT,
          size: 10,
          bold: true,
          color: { argb: XL.hoursText },
        };
      } else {
        if (isOdd) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.zebra } };
        }
        cell.font = {
          name: EXCEL_FONT,
          size: 10,
          bold: c === 'generatorNumber',
          color: { argb: c === 'notes' ? XL.mutedText : XL.text },
        };
      }

      if (c === 'date') cell.numFmt = 'dd/mm/yyyy';
      else if (typeof v === 'number') cell.numFmt = numFmt(v);

      const right = c === 'notes' || c === 'generatorName' || c === 'location';
      cell.alignment = {
        vertical: 'middle',
        readingOrder: 'rtl',
        horizontal: right ? 'right' : 'center',
        indent: right ? 1 : 0,
        wrapText: c === 'notes',
      };
    }
  }

  // حساب عرض الأعمدة بكفاءة O(N) دون استدعاء Math.max(...spread) لتفادي تجاوز المكدس في البيانات الضخمة
  activeCols.forEach((c, i) => {
    let longest = labels[c].length;
    for (let ri = 0; ri < data.length; ri++) {
      const len = displayLength(data[ri], c);
      if (len > longest) longest = len;
    }
    ws.getColumn(i + 1).width = Math.min(c === 'notes' ? 50 : 35, Math.max(12, longest + 4));
  });

  ws.autoFilter = { from: { row: H, column: 1 }, to: { row: H, column: n } };
  return wb;
}

// بناء قالب تقرير PDF / الطباعة الملون والحديث بالخطوط الجديدة مع الالتزام الكامل بالفلاتر والأعمدة المختارة
export function buildPrintableReportHTML(
  data,
  columns,
  { filtersText = '', createdAt = new Date(), title = 'تقرير تشغيل المولدات', embedFonts = true } = {}
) {
  const activeCols = Array.isArray(columns) && columns.length ? columns : Object.keys(labels);
  const summary = summarizeReportData(data);
  const safeTitle = escapeHtml(title);
  const safeFilters = escapeHtml(filtersText || 'لا يوجد (عرض شامل لجميع السجلات)');
  const safeDate = escapeHtml(
    createdAt.toLocaleString('ar', { dateStyle: 'full', timeStyle: 'short' })
  );
  const orientation = activeCols.length > 6 ? 'landscape' : 'portrait';

  const headersHtml = activeCols.map(c => `<th>${escapeHtml(labels[c])}</th>`).join('');

  const rowsHtml = data.length
    ? data
        .map(r => {
          const cells = activeCols
            .map(c => {
              const rawVal = c === 'date' ? niceDate(r.date) : r[c] ?? '';
              const safeVal = escapeHtml(rawVal);

              if (c === 'recordTypeLabel') {
                const isReset = r.recordType === 'meterReset' || rawVal === 'تغيير عداد';
                const badgeClass = isReset ? 'badge badge-amber' : 'badge badge-teal';
                return `<td class="center"><span class="${badgeClass}">${safeVal}</span></td>`;
              }
              if (c === 'operatingHours') {
                return `<td class="center hours-cell num">${safeVal}</td>`;
              }
              if (c === 'previousReading' || c === 'currentReading' || c === 'date') {
                return `<td class="center num">${safeVal}</td>`;
              }
              if (c === 'generatorNumber' || c === 'day') {
                return `<td class="center bold-cell">${safeVal}</td>`;
              }
              return `<td class="right-cell">${safeVal || '—'}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${activeCols.length}" class="empty-row">لا توجد سجلات مطابقة للفلاتر المحددة</td></tr>`;

  const hasHoursCol = activeCols.includes('operatingHours');
  const hoursColIndex = activeCols.indexOf('operatingHours');
  let footerHtml = '';
  if (data.length > 0 && hasHoursCol) {
    const footerCells = activeCols
      .map((c, idx) => {
        if (idx === 0) return `<td class="total-label">الإجمالي (${data.length} سجل)</td>`;
        if (idx === hoursColIndex) return `<td class="center num total-value">${summary.totalHours} ساعة</td>`;
        return `<td></td>`;
      })
      .join('');
    // صف الإجمالي كجسم أخير للجدول (وليس tfoot) حتى يظهر مرة واحدة في نهاية التقرير فقط، لا في أسفل كل صفحة مطبوعة.
    footerHtml = `<tbody class="total-body"><tr class="total-row">${footerCells}</tr></tbody>`;
  }

  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    ${embedFonts ? tajawalFontFaceCss() : ''}
    @page {
      size: A4 ${orientation};
      margin: 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: ${REPORT_FONT_STACK};
      color: #0f172a;
      background: #f8fafc;
      direction: rtl;
      text-align: right;
      line-height: 1.5;
    }
    .report-sheet {
      max-width: 1180px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
      overflow: hidden;
      padding: 24px;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1180px;
      margin: 0 auto 16px auto;
      padding: 12px 18px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
    }
    .toolbar-actions {
      display: flex;
      gap: 10px;
    }
    .btn {
      font-family: ${REPORT_FONT_STACK};
      font-size: 14px;
      font-weight: 700;
      padding: 8px 18px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
    }
    .btn-primary {
      background: #0f766e;
      color: #ffffff;
    }
    .btn-outline {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #cbd5e1;
    }
    .header-banner {
      background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
      color: #ffffff;
      padding: 22px 26px;
      border-radius: 14px;
      border-bottom: 4px solid #f59e0b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-banner h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.01em;
    }
    .header-sub {
      margin-top: 4px;
      font-size: 13px;
      color: #ccfbf1;
      font-weight: 500;
    }
    .header-meta {
      text-align: left;
      font-size: 12.5px;
      background: rgba(255, 255, 255, 0.12);
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 16px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-top: 3px solid #0f766e;
      border-radius: 12px;
      padding: 12px 16px;
    }
    .kpi-card.amber {
      border-top-color: #f59e0b;
    }
    .kpi-label {
      font-size: 12px;
      color: #64748b;
      font-weight: 700;
    }
    .kpi-value {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 4px;
      font-variant-numeric: tabular-nums;
    }
    .filter-banner {
      margin-top: 14px;
      background: #f0fdfa;
      border: 1px solid #99f6e4;
      border-right: 5px solid #0f766e;
      padding: 10px 16px;
      border-radius: 10px;
      font-size: 13px;
      color: #134e4a;
    }
    .filter-banner strong {
      font-weight: 800;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 18px;
      font-size: 12.5px;
    }
    thead {
      display: table-header-group;
    }
    tr {
      page-break-inside: avoid;
    }
    th {
      background: #115e59;
      color: #ffffff;
      font-weight: 800;
      padding: 11px 10px;
      border: 1px solid #0f766e;
      border-bottom: 3px solid #f59e0b;
      text-align: center;
      white-space: nowrap;
    }
    td {
      padding: 9px 10px;
      border: 1px solid #cbd5e1;
      color: #1e293b;
      vertical-align: middle;
      text-align: right;
    }
    tbody tr:nth-child(even) td {
      background: #f8fafc;
    }
    .center {
      text-align: center;
    }
    .right-cell {
      text-align: right;
    }
    .bold-cell {
      font-weight: 700;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    .hours-cell {
      font-weight: 800;
      color: #0f766e;
      background: #f0fdfa !important;
    }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge-teal {
      background: #dcfce7;
      color: #166534;
      border: 1px solid #86efac;
    }
    .badge-amber {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
    .total-row td {
      background: #ecfdf5 !important;
      font-weight: 800;
      border-top: 2px solid #0f766e;
      padding: 10px;
    }
    .total-label {
      color: #0f766e;
    }
    .total-value {
      color: #0f766e;
      font-size: 14px;
    }
    .empty-row {
      text-align: center;
      padding: 28px;
      color: #64748b;
      font-weight: 600;
    }
    .report-footer {
      margin-top: 22px;
      padding-top: 12px;
      border-top: 1px dashed #cbd5e1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      color: #64748b;
    }
    .table-wrap {
      width: 100%;
    }
    /* معاينة متجاوبة على الشاشات الصغيرة (الجوال): ملاءمة عرض الشاشة والتفاف البطاقات وتمرير الجدول أفقيًا داخل حاويته */
    @media screen and (max-width: 760px) {
      body {
        padding: 10px;
      }
      .toolbar {
        flex-wrap: wrap;
        gap: 10px;
        padding: 10px 12px;
      }
      .report-sheet {
        padding: 12px;
        border-radius: 12px;
      }
      .header-banner {
        padding: 16px;
      }
      .header-banner h1 {
        font-size: 20px;
      }
      .header-meta {
        text-align: right;
      }
      .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .kpi-card {
        padding: 10px 12px;
      }
      .kpi-value {
        font-size: 17px;
      }
      .table-wrap {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        margin-top: 14px;
        border-radius: 10px;
      }
      .table-wrap table {
        margin-top: 0;
        min-width: 640px;
      }
      .report-footer {
        flex-direction: column;
        gap: 6px;
        text-align: center;
      }
    }
    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }
      .table-wrap {
        overflow: visible !important;
      }
      .no-print {
        display: none !important;
      }
      .report-sheet {
        box-shadow: none;
        border: none;
        padding: 0;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <div><strong>معاينة التقرير الجاهز للطباعة والحفظ كملف PDF</strong></div>
    <div class="toolbar-actions">
      <button class="btn btn-primary" onclick="window.print()">طباعة / حفظ PDF</button>
      <button class="btn btn-outline" onclick="window.close()">إغلاق</button>
    </div>
  </div>
  <div class="report-sheet">
    <div class="header-banner">
      <div>
        <h1>${safeTitle}</h1>
        <div class="header-sub">نظام متابعة تشغيل المولدات • تقرير تشغيلي مستخرج وفق الفلاتر المحددة</div>
      </div>
      <div class="header-meta">
        <div>تاريخ الإنشاء: ${safeDate}</div>
        <div>الأعمدة المعروضة: ${activeCols.length} أعمدة</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">عدد النتائج</div>
        <div class="kpi-value">${summary.count}</div>
      </div>
      <div class="kpi-card amber">
        <div class="kpi-label">إجمالي ساعات التشغيل</div>
        <div class="kpi-value">${summary.totalHours} ساعة</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">المولدات المشمولة</div>
        <div class="kpi-value">${summary.uniqueGenerators}</div>
      </div>
      <div class="kpi-card amber">
        <div class="kpi-label">سجل يومي / تغيير عداد</div>
        <div class="kpi-value">${summary.dailyCount} / ${summary.meterResetCount}</div>
      </div>
    </div>

    <div class="filter-banner">
      <strong>الفلاتر المطبقة:</strong> ${safeFilters}
    </div>

    <div class="table-wrap">
    <table>
      <thead>
        <tr>${headersHtml}</tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      ${footerHtml}
    </table>
    </div>

    <div class="report-footer">
      <div>مستخرج آليًا من نظام متابعة تشغيل المولدات (بيانات مطابقة للفلاتر المطبقة)</div>
      <div>برمجة وتطوير: م. محمد أبو زهري ♥️</div>
    </div>
  </div>
</body>
</html>`;
}

export async function exportExcel(data, columns, title, filtersText) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = buildExcelWorkbook(ExcelJS, data, columns, { filtersText });
  const buffer = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
  a.download = `${title}-${stamp()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportCSV(data, columns, title) {
  const csv = buildCSV(data, columns);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${title}-${stamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportPDF(
  data,
  columns,
  title = 'تقرير تشغيل المولدات',
  filtersText = '',
  // على الشاشات الصغيرة/اللمسية تُفتح المعاينة كتبويب كامل بعرض الجهاز بدل نافذة بعرض ثابت 1100px.
  openWin = () =>
    window.open(
      '',
      '_blank',
      window.matchMedia?.('(max-width: 900px), (pointer: coarse)').matches ? '' : 'width=1100,height=800'
    )
) {
  const win = openWin();
  // في نافذة الطباعة تُضاف ملفات الخط برمجيًا (تعمل دون اتصال)، فلا حاجة لقواعد @font-face التي تُحمَّل من الشبكة.
  const html = buildPrintableReportHTML(data, columns, { filtersText, title, embedFonts: !win?.FontFace });
  if (win && win.document) {
    win.document.write(html);
    win.document.close();
    // انتظار تحميل خط Tajawal المحلي (بحد أقصى 1.5 ثانية) قبل فتح نافذة الطباعة.
    Promise.race([
      attachTajawalFonts(win).then(() => win.document.fonts?.ready),
      new Promise(r => setTimeout(r, 1500)),
    ])
      .catch(() => {})
      .then(() =>
        setTimeout(() => {
          try {
            win.focus?.();
            win.print?.();
          } catch {}
        }, 300)
      );
    return true;
  }

  // بديل آمن عبر iframe مخفي إذا حظر المتصفح النوافذ المنبثقة
  try {
    if (typeof document === 'undefined') return false;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();
    attachTajawalFonts(iframe.contentWindow).catch(() => {});
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => iframe.remove(), 2000);
      }
    }, 350);
    return true;
  } catch {
    return false;
  }
}

export const reportLabels = labels;

// صياغة عربية مفهومة للفلاتر المطبقة، تستخدمها الطباعة وتقرير PDF وتقرير Excel.
const filterLabels = {
  q: 'بحث شامل',
  from: 'من تاريخ',
  to: 'إلى تاريخ',
  day: 'اليوم',
  generator: 'المولد',
  type: 'نوع السجل',
  prev: 'القراءة السابقة',
  current: 'القراءة الحالية',
  hours: 'ساعات التشغيل',
};

export const describeFilters = (filters, generators) =>
  Object.entries(filters)
    .filter(([k, v]) => filterLabels[k] && v !== '' && v !== 'all' && v != null)
    .map(([k, v]) => {
      let text = v;
      if (k === 'from' || k === 'to') text = niceDate(v);
      else if (k === 'type') text = RECORD_TYPES[v] || v;
      else if (k === 'generator') {
        const g = generators.find(x => x.id === v);
        text = g ? `${g.number} | ${g.name}` : 'مولد غير معروف';
      } else if (k === 'q') text = `«${v}»`;
      return `${filterLabels[k]}: ${text}`;
    })
    .join('، ');

// فلاتر صفحة سجل التشغيل ونتيجتها هي ما يُعرض ويُصدَّر فقط.
export const filterLogs = (logs, generators, filters) =>
  sortLogs(logs).filter(x => {
    const g = generators.find(y => y.id === x.generatorId) || {};
    const hay = [
      g.number,
      g.name,
      g.location,
      x.date,
      niceDate(x.date),
      x.day,
      x.notes,
      x.recordType === 'daily' ? 'سجل يومي' : 'تغيير عداد',
    ]
      .join(' ')
      .toLowerCase();
    return (
      hay.includes(String(filters.q || '').toLowerCase()) &&
      (!filters.from || x.date >= filters.from) &&
      (!filters.to || x.date <= filters.to) &&
      (filters.day === 'all' || x.day === filters.day) &&
      (filters.generator === 'all' || x.generatorId === filters.generator) &&
      (filters.type === 'all' || x.recordType === filters.type) &&
      (filters.prev === '' || Number(x.previousReading) === Number(filters.prev)) &&
      (filters.current === '' || Number(x.currentReading) === Number(filters.current)) &&
      (filters.hours === '' || roundHours(x.operatingHours) === roundHours(filters.hours))
    );
  });
