// Acceptance tests for reports & exports (spec §14, REPORT-001..011, FIELD-011, CHL-006).
// Real engine + real exporters; CSV/XLSX are captured as the Blob the browser would download and parsed back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { buildAomsReport } from '../domain/aomsEngine';
import { exportAomsCSV, exportAomsExcel, formatUsageSummaryText, getAomsReportColumns } from './aomsReportService';

const cat = (id, code, extra = {}) => ({ id, name: `تصنيف ${code}`, code_prefix: code, is_active: true, uses_meter: true, meter_unit: 'ساعة', supports_fuel: false, supports_chlorine: false, ...extra });
const field = (id, category_id, key, extra = {}) => ({ id, category_id, field_key: key, label: key, field_type: 'text', scope: 'operation', is_active: true, show_in_reports: true, sort_order: 0, ...extra });
const state = {
  categories: [
    cat('c-gen', 'GEN', { meter_unit: 'ساعة تشغيل', supports_fuel: true }),
    cat('c-wel', 'WEL', { meter_unit: 'م³', supports_chlorine: true, chlorine_unit: 'كجم' }),
    cat('c-bst', 'BST', { meter_unit: 'م³', supports_chlorine: true, chlorine_unit: 'لتر' }),
  ],
  category_fields: [
    field('f-oil', 'c-gen', 'oil_temp', { label: 'حرارة الزيت', unit: '°C', sort_order: 2 }),
    field('f-pres', 'c-gen', 'pressure', { label: 'ضغط', sort_order: 1 }),
    field('f-secret', 'c-gen', 'secret', { label: 'ملاحظة داخلية', show_in_reports: false }),
    field('f-lvl', 'c-wel', 'level', { label: 'منسوب البئر', unit: 'م' }),
  ],
  category_field_options: [],
  assets: [
    { id: 'a-g1', asset_code: 'GEN-0001', name: 'مولد 1', category_id: 'c-gen', status: 'active' },
    { id: 'a-g2', asset_code: 'GEN-0002', name: 'مولد 2', category_id: 'c-gen', status: 'active' },
    { id: 'a-w1', asset_code: 'WEL-0001', name: 'بئر 1', category_id: 'c-wel', status: 'active' },
    { id: 'a-b1', asset_code: 'BST-0001', name: 'معزز 1', category_id: 'c-bst', status: 'active' },
  ],
  operators: [{ id: 'o1', name: 'أحمد', status: 'active' }],
  fuel_types: [{ id: 'ft', name: 'ديزل', unit: 'لتر' }],
  operation_logs: [
    { id: 'l1', asset_id: 'a-g1', operation_date: '2026-10-20', net_operation_delta: 5, fuel_consumed: 20, chlorine_consumed: 0, operator_id: 'o1', version: 1, notes: '=HYPERLINK("http://evil","x")' },
    { id: 'l2', asset_id: 'a-g1', operation_date: '2026-10-22', net_operation_delta: 6, fuel_consumed: 24, chlorine_consumed: 0, operator_id: 'o1', version: 2 },
    { id: 'l3', asset_id: 'a-g2', operation_date: '2026-10-21', net_operation_delta: 4, fuel_consumed: 16, chlorine_consumed: 0, operator_id: 'o1', version: 1 },
    { id: 'l4', asset_id: 'a-w1', operation_date: '2026-10-21', net_operation_delta: 100, fuel_consumed: 0, chlorine_consumed: 2, operator_id: 'o1', version: 1, notes: '+SUM(A1:A9)' },
    { id: 'l5', asset_id: 'a-b1', operation_date: '2026-10-25', net_operation_delta: 50, fuel_consumed: 0, chlorine_consumed: 3, operator_id: 'o1', version: 1, notes: '@cmd' },
  ],
  operation_log_values: [
    { operation_log_id: 'l1', field_id: 'f-oil', value_number: 88 },
    { operation_log_id: 'l1', field_id: 'f-secret', value_text: 'سري' },
    { operation_log_id: 'l4', field_id: 'f-lvl', value_number: 37 },
  ],
  fuel_transactions: [
    { id: 't1', asset_id: 'a-g1', fuel_type_id: 'ft', transaction_type: 'issue', quantity: 50, transaction_date: '2026-10-20', version: 1 },
    { id: 't2', asset_id: 'a-g2', fuel_type_id: 'ft', transaction_type: 'issue', quantity: 30, transaction_date: '2026-10-21', version: 1 },
  ],
  chlorine_transactions: [
    { id: 'k1', asset_id: 'a-w1', transaction_type: 'issue', quantity: 5, transaction_date: '2026-10-21', version: 1 },
    { id: 'k2', asset_id: 'a-b1', transaction_type: 'issue', quantity: 7, transaction_date: '2026-10-22', version: 1 },
  ],
};
const codes = r => r.rows.map(x => x.asset_code).sort();

describe('buildAomsReport scopes and rules (spec §14)', () => {
  it('REPORT-001 single asset', () => {
    const r = buildAomsReport(state, { scope: 'asset', assetId: 'a-g1' });
    expect(codes(r)).toEqual(['GEN-0001', 'GEN-0001']);
  });
  it('REPORT-002 whole category, FIELD-011 hidden field not reported, field order by sort_order', () => {
    const r = buildAomsReport(state, { scope: 'category', categoryId: 'c-gen' });
    expect(codes(r)).toEqual(['GEN-0001', 'GEN-0001', 'GEN-0002']);
    expect(r.dynamicColumns.map(f => f.field_key)).toEqual(['pressure', 'oil_temp']);
    const labels = getAomsReportColumns(r.type, r.dynamicColumns).map(c => c.label);
    expect(labels).toContain('حرارة الزيت (°C)');
    expect(labels).not.toContain('ملاحظة داخلية');
    expect(r.rows.every(x => !('dyn_secret' in x))).toBe(true);
  });
  it('REPORT-003 multiple assets from different categories (operations, fuel and chlorine)', () => {
    const f = { scope: 'multi_assets', assetIds: ['a-g1', 'a-w1'] };
    expect(codes(buildAomsReport(state, f))).toEqual(['GEN-0001', 'GEN-0001', 'WEL-0001']);
    expect(codes(buildAomsReport(state, { ...f, eventType: 'fuel' }))).toEqual(['GEN-0001']);
    expect(codes(buildAomsReport(state, { ...f, eventType: 'chlorine' }))).toEqual(['WEL-0001']);
  });
  it('REPORT-004 all assets', () => {
    expect(buildAomsReport(state, { scope: 'all_assets' }).rows).toHaveLength(5);
  });
  it('REPORT-005 from/to filter is inclusive', () => {
    const r = buildAomsReport(state, { scope: 'all_assets', from: '2026-10-21', to: '2026-10-22' });
    expect(r.rows.map(x => x.operation_date).sort()).toEqual(['2026-10-21', '2026-10-21', '2026-10-22']);
  });
  it('REPORT-006 multi-category: common columns first, category-labelled dynamic columns, non-applicable values empty', () => {
    const r = buildAomsReport(state, { scope: 'multi_assets', assetIds: ['a-g1', 'a-w1'] });
    const cols = getAomsReportColumns(r.type, r.dynamicColumns);
    const dynIdx = cols.findIndex(c => c.key.startsWith('dyn_'));
    expect(cols.slice(0, dynIdx).every(c => !c.key.startsWith('dyn_'))).toBe(true);
    expect(cols.slice(dynIdx).map(c => c.label)).toEqual(['ضغط — تصنيف GEN', 'حرارة الزيت (°C) — تصنيف GEN', 'منسوب البئر (م) — تصنيف WEL']);
    const l1 = r.rows.find(x => x.id === 'l1');
    const l4 = r.rows.find(x => x.id === 'l4');
    expect(l1['dyn_f-oil']).toBe(88);
    expect(l1['dyn_f-lvl']).toBe('');
    expect(l4['dyn_f-lvl']).toBe(37);
    expect(l4['dyn_f-oil']).toBe('');
    expect(cols.map(c => c.label)).not.toContain('ملاحظة داخلية — تصنيف GEN');
  });
  it('REPORT-007 different units are never summed into one number', () => {
    const r = buildAomsReport(state, { scope: 'all_assets' });
    expect(r.summary.net_operation_by_unit).toEqual({ 'ساعة تشغيل': 15, 'م³': 150 });
    expect(r.summary.chlorine_consumed_by_unit).toEqual({ كجم: 2, لتر: 3 });
    const text = formatUsageSummaryText(r.summary);
    expect(text).toContain('15 (ساعة تشغيل)');
    expect(text).toContain('150 (م³)');
    expect(text).toContain('2 (كجم) | 3 (لتر)');
    expect(text).not.toContain('165');
  });
  it('CHL-006 chlorine unit is the category unit in the chlorine report', () => {
    const r = buildAomsReport(state, { scope: 'all_assets', eventType: 'chlorine' });
    expect(Object.fromEntries(r.rows.map(x => [x.asset_code, x.unit_snapshot]))).toEqual({ 'WEL-0001': 'كجم', 'BST-0001': 'لتر' });
  });
});

describe('exports (captured Blob, parsed back)', () => {
  let blobs;
  beforeEach(() => {
    blobs = [];
    vi.stubGlobal('document', { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { blobs.push(b); return 'blob:x'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const parseCsv = text => {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
      else cell += ch;
    }
    row.push(cell); rows.push(row); return rows;
  };

  it('REPORT-010 CSV neutralises formula injection and keeps the screen values (REPORT-008)', async () => {
    const r = buildAomsReport(state, { scope: 'all_assets' });
    exportAomsCSV(r, 'تقرير');
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM so Excel opens Arabic correctly
    const rows = parseCsv(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).slice(1));
    const cols = getAomsReportColumns(r.type, r.dynamicColumns);
    expect(rows[2]).toEqual(cols.map(c => c.label));
    const notesIdx = cols.findIndex(c => c.key === 'notes');
    const notes = rows.slice(3).map(x => x[notesIdx]);
    expect(notes).toContain(`'=HYPERLINK("http://evil","x")`);
    expect(notes).toContain(`'+SUM(A1:A9)`);
    expect(notes).toContain(`'@cmd`);
    expect(notes.every(n => !/^[=+\-@]/.test(n))).toBe(true);
    // every data cell equals the value rendered on screen (format + '—' for empty)
    r.rows.forEach((row, i) => cols.forEach((c, j) => {
      const v = row[c.key];
      const shown = v === null || v === undefined || v === '' ? '—' : String(c.format ? c.format(v, row) : v);
      expect(rows[3 + i][j].replace(/^'(?=[=+\-@])/, '')).toBe(shown);
    }));
    expect(rows[1][0]).toBe(formatUsageSummaryText(r.summary));
  });

  it('REPORT-009 Excel is RTL, header row 4, data equals screen, formula-like text stored as plain text', async () => {
    const r = buildAomsReport(state, { scope: 'category', categoryId: 'c-gen' });
    await exportAomsExcel(r, 'تقرير', 'الكل');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await blobs[0].arrayBuffer()));
    const ws = wb.worksheets[0];
    expect(ws.views[0].rightToLeft).toBe(true);
    const cols = getAomsReportColumns(r.type, r.dynamicColumns);
    expect(cols.map((c, i) => ws.getRow(4).getCell(i + 1).value)).toEqual(cols.map(c => c.label));
    expect(ws.getCell(3, 1).value).toBe(formatUsageSummaryText(r.summary));
    r.rows.forEach((row, i) => cols.forEach((c, j) => {
      const v = row[c.key];
      const shown = v === null || v === undefined || v === '' ? '—' : c.format ? c.format(v, row) : v;
      expect(ws.getRow(5 + i).getCell(j + 1).value).toEqual(shown);
    }));
    const notesCol = cols.findIndex(c => c.key === 'notes') + 1;
    const cells = r.rows.map((_, i) => ws.getRow(5 + i).getCell(notesCol));
    const inj = cells.find(c => String(c.value).startsWith('=HYPERLINK'));
    expect(inj.type).toBe(ExcelJS.ValueType.String);
    expect(inj.formula).toBeUndefined();
  });
});
