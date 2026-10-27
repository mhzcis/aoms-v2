import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildCSV,
  buildExcelWorkbook,
  buildPrintableReportHTML,
  orderReportData,
  REPORT_ORDERS,
  describeFilters,
  enrich,
  escapeHtml,
  EXCEL_FONT,
  EXCEL_HEADER_ROW,
  EXCEL_SHEET_NAME,
  filterLogs,
  reportLabels,
  sanitizeCsvCell,
  summarizeReportData,
} from './reportService';
import { gen, log } from '../test/fixtures';

const generators = [
  gen('a', { number: 'G-1', name: 'مولد الورشة', location: 'خانيونس' }),
  gen('b', { number: 'G-2', name: 'مولد المكاتب', location: 'غزة' }),
];
const logs = [
  log('1', 'a', '2026-10-01', {
    day: 'الخميس',
    previousReading: 0,
    currentReading: 10,
    operatingHours: 10,
    notes: 'تشغيل عادي',
  }),
  log('2', 'a', '2026-10-02', {
    day: 'الجمعة',
    previousReading: 10,
    currentReading: 1500.5,
    operatingHours: 1490.5,
  }),
  log('3', 'b', '2026-10-02', {
    day: 'الجمعة',
    recordType: 'meterReset',
    previousReading: 30,
    currentReading: 2,
    operatingHours: 0,
  }),
  log('4', 'b', '2026-10-03', {
    day: 'السبت',
    previousReading: 2,
    currentReading: 8,
    operatingHours: 6,
  }),
];
const init = {
  q: '',
  from: '',
  to: '',
  day: 'all',
  generator: 'all',
  type: 'all',
  prev: '',
  current: '',
  hours: '',
};
const roundTrip = async wb => {
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await wb.xlsx.writeBuffer());
  return out;
};

describe('التقارير وExcel وPDF وCSV والأمان', () => {
  const filters = { ...init, generator: 'a', from: '2026-10-02', type: 'daily' };
  const filtered = enrich(filterLogs(logs, generators, filters), generators);
  const columns = ['operatingHours', 'generatorName', 'date', 'notes'];

  it('Excel يحتوي النتائج المفلترة فقط مع إجمالي ساعاتها في الترويسة', async () => {
    expect(filtered.map(x => x.id)).toEqual(['2']);
    const ws = (
      await roundTrip(
        buildExcelWorkbook(ExcelJS, filtered, columns, {
          filtersText: describeFilters(filters, generators),
        })
      )
    ).getWorksheet(EXCEL_SHEET_NAME);
    expect(ws.rowCount).toBe(EXCEL_HEADER_ROW + 1);
    expect(ws.getRow(EXCEL_HEADER_ROW + 1).getCell(1).value).toBe(1490.5);
    expect(ws.getCell('A2').value).toContain('1490.5 ساعة');
    expect(ws.getCell('A3').value).toBe('عدد النتائج: 1');
  });

  it('Excel يحترم الأعمدة المختارة وترتيبها', async () => {
    const ws = (await roundTrip(buildExcelWorkbook(ExcelJS, filtered, columns))).getWorksheet(
      EXCEL_SHEET_NAME
    );
    const header = ws.getRow(EXCEL_HEADER_ROW).values.slice(1);
    expect(header).toEqual(columns.map(c => reportLabels[c]));
    expect(ws.getRow(EXCEL_HEADER_ROW).cellCount).toBe(4);
  });

  it('ورقة Excel باتجاه RTL ومنسقة بالخط الجديد (Tajawal) وألوان حديثة وتنسيق شرطي وتجميد وطباعة', async () => {
    const all = enrich(filterLogs(logs, generators, init), generators);
    const cols = Object.keys(reportLabels);
    const ws = (
      await roundTrip(buildExcelWorkbook(ExcelJS, all, cols, { filtersText: 'لا يوجد' }))
    ).getWorksheet(EXCEL_SHEET_NAME);
    expect(ws.name).toBe('تقرير التشغيل');
    expect(ws.views[0]).toMatchObject({
      rightToLeft: true,
      state: 'frozen',
      ySplit: EXCEL_HEADER_ROW,
    });
    expect(ws.getCell('A1').value).toBe('تقرير تشغيل المولدات');
    expect(ws.model.merges).toEqual(
      expect.arrayContaining(['A1:J1', 'A2:J2', 'A3:J3', 'A4:J4'])
    );
    expect(ws.getCell('A1').font).toMatchObject({ bold: true, size: 18 });
    expect(ws.getCell('A1').fill.fgColor.argb).toBe('FF0F766E');
    expect(String(ws.autoFilter)).toBe('A5:J5');
    const head = ws.getCell(`A${EXCEL_HEADER_ROW}`);
    expect(head.font.bold).toBe(true);
    expect(head.fill.fgColor.argb).toBe('FF115E59');
    const first = ws.getRow(EXCEL_HEADER_ROW + 1);
    expect(first.getCell(1).value).toBeInstanceOf(Date);
    expect(first.getCell(1).numFmt).toBe('dd/mm/yyyy');
    expect(first.getCell(1).border.top.style).toBe('thin');
    const notes = first.getCell(cols.indexOf('notes') + 1);
    expect(notes.alignment).toMatchObject({ wrapText: true, horizontal: 'right' });
    expect(typeof first.getCell(cols.indexOf('operatingHours') + 1).value).toBe('number');
    expect(first.getCell(cols.indexOf('currentReading') + 1).numFmt).toMatch(/#,##0/);
    ws.columns.forEach(c => {
      expect(c.width).toBeGreaterThanOrEqual(12);
      expect(c.width).toBeLessThanOrEqual(50);
    });
    expect(ws.pageSetup).toMatchObject({
      orientation: 'landscape',
      fitToWidth: 1,
      printTitlesRow: '5:5',
      paperSize: 9,
    });
    expect(EXCEL_FONT).toBe('Tajawal');
    const fonts = new Set();
    ws.eachRow(row => row.eachCell(c => fonts.add(c.font?.name)));
    expect([...fonts]).toEqual(['Tajawal']);
  });

  it('تقرير PDF / الطباعة يلتزم بالفلاتر والأعمدة المختارة ويستخدم الخطوط الجديدة والتنسيق الملون', () => {
    const fText = describeFilters(filters, generators);
    const html = buildPrintableReportHTML(filtered, columns, { filtersText: fText });
    expect(html).toContain('Tajawal');
    expect(html).toContain('Cairo');
    // خط Tajawal مستضاف ذاتيًا (لا CDN) ليعمل دون اتصال
    expect(html).toContain("@font-face{font-family:'Tajawal'");
    expect(html).toMatch(/tajawal-arabic-400-normal[^)]*\.woff2/);
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain(fText);
    expect(html).toContain('1490.5 ساعة');
    expect(html).toContain('مولد الورشة');
    expect(html).not.toContain('مولد المكاتب');
    expect(html).toContain('@page');
  });

  it('يحسب الملخص الإحصائي للبيانات المفلترة بدقة عالية', () => {
    const all = enrich(filterLogs(logs, generators, init), generators);
    expect(summarizeReportData(all)).toEqual({
      count: 4,
      totalHours: 1506.5,
      uniqueGenerators: 2,
      dailyCount: 3,
      meterResetCount: 1,
    });
  });

  it('يصوغ الفلاتر المطبقة بالعربية لا بأسماء المفاتيح', () => {
    const text = describeFilters(
      { ...init, q: 'ورشة', generator: 'a', type: 'meterReset', from: '2026-10-01', hours: '0' },
      generators
    );
    expect(text).toBe(
      'بحث شامل: «ورشة»، من تاريخ: 01/10/2026، المولد: G-1 | مولد الورشة، نوع السجل: تغيير عداد، ساعات التشغيل: 0'
    );
    expect(text).not.toMatch(/generator|type|from|hours/);
    expect(describeFilters(init, generators)).toBe('');
  });

  it('يعرض السجلات الأحدث أولًا ويبحث في الموقع واليوم والتاريخ أيضًا', () => {
    expect(filterLogs(logs, generators, init).map(x => x.id)).toEqual(['4', '2', '3', '1']);
    expect(filterLogs(logs, generators, { ...init, q: 'خانيونس' }).map(x => x.id)).toEqual([
      '2',
      '1',
    ]);
    expect(filterLogs(logs, generators, { ...init, q: 'السبت' }).map(x => x.id)).toEqual(['4']);
  });

  it('يعقم خلايا CSV ضد حقن المعادلات (CSV Injection) ويعقم HTML ضد XSS', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(sanitizeCsvCell('@cmd')).toBe("'@cmd");
    const csv = buildCSV(
      [{ date: '2026-10-01', notes: '=HYPERLINK("http://evil")' }],
      ['date', 'notes']
    );
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });
});

describe('التعديلات الثالثة: ترتيب التقرير وصف الإجمالي', () => {
  const rows = [
    { id: '1', date: '2026-10-01', createdAt: '2026-10-01T10:00:00Z', operatingHours: 5, recordType: 'daily' },
    { id: '3', date: '2026-10-03', createdAt: '2026-10-03T10:00:00Z', operatingHours: 4, recordType: 'daily' },
    { id: '2', date: '2026-10-02', createdAt: '2026-10-02T10:00:00Z', operatingHours: 3, recordType: 'daily' },
  ];

  it('الترتيب الافتراضي الأحدث أولًا، ويمكن اختيار الأقدم أولًا، ويطبَّق على CSV والطباعة', () => {
    expect(orderReportData(rows).map(r => r.id)).toEqual(['3', '2', '1']);
    expect(orderReportData(rows, 'newest').map(r => r.id)).toEqual(['3', '2', '1']);
    expect(orderReportData(rows, 'oldest').map(r => r.id)).toEqual(['1', '2', '3']);
    expect(REPORT_ORDERS).toEqual({ newest: 'الأحدث أولًا', oldest: 'الأقدم أولًا' });
    const csv = buildCSV(orderReportData(rows, 'oldest'), ['date']);
    expect(csv.split('\r\n').slice(1)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    const html = buildPrintableReportHTML(orderReportData(rows, 'oldest'), ['date', 'operatingHours']);
    expect(html.indexOf('01/10/2026')).toBeLessThan(html.indexOf('03/10/2026'));
  });

  it('صف الإجمالي في نهاية الجدول فقط (ليس tfoot المتكرر في كل صفحة) والإجمالي في رأس التقرير', () => {
    const html = buildPrintableReportHTML(rows, ['date', 'operatingHours']);
    expect(html).not.toContain('<tfoot');
    expect(html).not.toMatch(/table-footer-group/);
    expect(html.match(/class="total-row"/g)).toHaveLength(1);
    expect(html.indexOf('class="total-row"')).toBeGreaterThan(html.lastIndexOf('<td class="center num">'));
    expect(html.indexOf('class="total-row"')).toBeLessThan(html.indexOf('</table>'));
    expect(html).toContain('<div class="kpi-label">إجمالي ساعات التشغيل</div>');
    expect(html).toContain('12 ساعة');
  });

  it('معاينة الطباعة متجاوبة على الجوال مع إبقاء تخطيط A4 للطباعة', () => {
    const html = buildPrintableReportHTML(rows, ['date']);
    expect(html).toContain('@media screen and (max-width: 760px)');
    expect(html).toContain('<div class="table-wrap">');
    expect(html).toMatch(/@page \{\s*size: A4/);
  });
});
