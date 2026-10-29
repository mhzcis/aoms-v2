import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import * as pdfTable from 'jspdf-autotable';
import { buildAomsReport } from '../domain/aomsEngine';
import { AomsService } from './aomsService';
import { exportAomsCSV, exportAomsExcel, exportAomsPDF, getAomsReportColumns } from './aomsReportService';
import { businessDateTime, businessTimeZone, recentEvents } from '../utils/businessTime';
import { FIELD_SCOPES, localTodayISO } from '../domain/models';
import { operatorErrors } from '../utils/operatorValidation';
import { auditActor, auditChanges } from '../components/AuditDetails';

vi.mock('jspdf-autotable', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, default: vi.fn(actual.default) };
});

const state = {
  app_settings: [{ key: 'business_timezone', value: 'Asia/Jerusalem' }],
  categories: [{ id: 'c', name: 'مضخات', code_prefix: 'PMP', uses_meter: true, meter_unit: 'ساعة تشغيل', chlorine_unit: 'كجم' }],
  assets: [{ id: 'a', asset_code: 'PMP-0002', name: 'مضخة اختبار', category_id: 'c', fuel_type_id: 'f' }],
  operators: [{ id: 'o', name: 'مشغل اختبار' }], fuel_types: [{ id: 'f', name: 'سولار', unit: 'لتر' }],
  category_fields: [
    { id: 'fa', category_id: 'c', field_key: 'same', label: 'وصف الأصل', scope: 'asset', field_type: 'text', is_active: true, show_in_reports: true },
    { id: 'fl', category_id: 'c', field_key: 'same', label: 'رقم التشغيل', scope: 'operation', field_type: 'number', is_active: true, show_in_reports: true },
    { id: 'fh', category_id: 'c', field_key: 'hidden', label: 'مخفي', scope: 'asset', field_type: 'text', is_active: true, show_in_reports: false },
  ],
  asset_field_values: [{ asset_id: 'a', field_id: 'fa', value_text: 'QA-TOKEN' }],
  operation_log_values: [{ operation_log_id: 'same-id', field_id: 'fl', value_number: 7.5 }],
  operation_logs: [{ id: 'same-id', asset_id: 'a', operator_id: 'o', operation_date: '2026-10-28', usage_value: 1, fuel_consumed: 12, chlorine_consumed: 2, water_total: 10, network_quantity: 10 }],
  fuel_transactions: [{ id: 'same-id', asset_id: 'a', operator_id: 'o', fuel_type_id: 'f', transaction_date: '2026-10-29', transaction_type: 'supply', quantity: 1000, invoice_number: 'QA-FUEL-01' }],
  chlorine_transactions: [{ id: 'same-id', asset_id: 'a', transaction_date: '2026-10-27', transaction_type: 'receipt', quantity: 500 }],
};
beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));
afterEach(() => vi.unstubAllGlobals());

describe('approved QA regression: reports F01/F05/F06/F10/F11', () => {
  it('all events includes the three sources, unique row keys, date order and operational-only consumption', () => {
    const r = buildAomsReport(state, { eventType: 'all', scope: 'all_assets' });
    expect(r.type).toBe('events'); expect(r.rows.map(x => x.event_type)).toEqual(['fuel', 'operations', 'chlorine']);
    expect(new Set(r.rows.map(x => x.id)).size).toBe(3);
    expect(r.summary).toMatchObject({ count: 3, fuel_consumed_total: 12, chlorine_consumed_total: 2, water_total: 10, event_counts: { operations: 1, fuel: 1, chlorine: 1 } });
    expect(getAomsReportColumns(r.type).map(c => c.key)).toEqual(expect.arrayContaining(['quantity', 'fuel_consumed', 'event_type_label', 'event_date']));
  });
  it('all-event date/operator/scope filters apply to every source without fallback to all assets', () => {
    expect(buildAomsReport(state, { eventType: 'all', scope: 'asset', assetId: 'a', from: '2026-10-28', operatorId: 'o' }).rows).toHaveLength(2);
    expect(buildAomsReport(state, { eventType: 'all', scope: 'multi_assets', assetIds: ['a'], to: '2026-10-27' }).rows).toHaveLength(1);
  });
  it.each([{ scope: 'asset' }, { scope: 'category' }, { scope: 'multi_assets', assetIds: [] }, { scope: 'asset', assetId: 'deleted' }, { from: '2026-10-30', to: '2026-10-01' }, { from: '2026-02-30' }])('incomplete/invalid filters return an explanatory error and no rows: %j', filters => {
    const r = buildAomsReport(state, filters); expect(r.valid).toBe(false); expect(r.filterError).toBeTruthy(); expect(r.rows).toEqual([]);
    expect(() => exportAomsCSV(r)).toThrow();
  });
  it('asset fields and operation fields with the same key both survive in category and single-asset reports', () => {
    for (const filters of [{ scope: 'category', categoryId: 'c' }, { scope: 'asset', assetId: 'a' }]) {
      const r = buildAomsReport(state, filters);
      expect(r.rows[0]['dyn_asset:fa']).toBe('QA-TOKEN'); expect(r.rows[0].dyn_same).toBe(7.5);
      expect(r.dynamicColumns).toHaveLength(2);
      expect(r.rows[0]).not.toHaveProperty('dyn_hidden');
    }
  });
  it('CSV and actual XLSX metadata identify selected records, period and event/operator filters', async () => {
    const r = buildAomsReport(state, { scope: 'asset', assetId: 'a', from: '2026-10-28', to: '2026-10-29', operatorId: 'o', eventType: 'all' });
    expect(r.filtersSummary).toContain('PMP-0002 | مضخة اختبار'); expect(r.filtersSummary).toContain('2026-10-28'); expect(r.filtersSummary).toContain('جميع الأحداث');
    const blobs = [];
    vi.stubGlobal('URL', { createObjectURL: b => (blobs.push(b), 'blob:test'), revokeObjectURL: () => {} });
    vi.stubGlobal('document', { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } });
    exportAomsCSV(r); expect(await blobs[0].text()).toContain(r.filtersSummary);
    await exportAomsExcel(r);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await blobs[1].arrayBuffer());
    const ws = wb.getWorksheet('الملخص'); expect(ws.getCell(2, 2).value).toContain(r.filtersSummary);
    expect(ws.getCell(4, 2).value).toContain('Asia/Jerusalem'); expect(wb.getWorksheet('التفاصيل').rowCount).toBe(r.rows.length+1);
  });
  it('mixed fuel units are labelled individually in the summary rather than added as one unit', () => {
    const copy = structuredClone(state); copy.fuel_types.push({ id: 'g', name: 'وقود آخر', unit: 'جالون' });
    copy.operation_logs.push({ id: 'second', asset_id: 'a', fuel_type_id: 'g', operation_date: '2026-10-29', fuel_consumed: 3 });
    expect(buildAomsReport(copy).summary.fuel_consumed_by_unit).toEqual({ لتر: 12, جالون: 3 });
  });
  it('wide Arabic PDF paginates without clipping and preserves every column and record', async () => {
    const cells = [];
    const actual = (await vi.importActual('jspdf-autotable')).default;
    const spy = pdfTable.default.mockImplementation((doc, options) => actual(doc, {
      ...options, didDrawCell: data => cells.push({ x: data.cell.x, width: data.cell.width, text: data.cell.text.join(' '), section: data.section }),
    }));
    try {
      const fonts = Object.fromEntries(['Regular', 'Bold'].map(style => [`amiri${style}`, readFileSync(`public/fonts/Amiri-${style}.ttf`).toString('base64')]));
      const report = buildAomsReport(state, { eventType: 'all' });
      const doc = await exportAomsPDF(report, undefined, undefined, fonts);
      expect(doc.getNumberOfPages()).toBeGreaterThan(1);
      const pageWidth = doc.internal.pageSize.getWidth();
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) { expect(cell.x).toBeGreaterThanOrEqual(19.9); expect(cell.x + cell.width).toBeLessThanOrEqual(pageWidth - 19.9); }
      const headings = cells.filter(c => c.section === 'head').map(c => c.text.replace(/\s/g, ''));
      for (const col of getAomsReportColumns(report.type, report.dynamicColumns)) expect(headings).toContain(col.label.replace(/\s/g, ''));
      expect(cells.some(c => c.text.includes('QA-TOKEN'))).toBe(true);
      expect(cells.filter(c => c.section === 'body' && c.text.includes('PMP-0002')).length).toBeGreaterThanOrEqual(report.rows.length * 2);
    } finally { spy.mockImplementation(actual); }
  });
});

describe('approved QA regression: scopes, validation, recent events and audit', () => {
  it('shows two canonical field scopes and normalises a legacy operation_log write before the managed RPC', async () => {
    expect(FIELD_SCOPES).toEqual(['asset', 'operation']);
    const repo = { invoke: vi.fn() }; const service = new AomsService(repo);
    await service.saveCategoryField({ category_id: 'c', scope: 'operation_log', field_key: 'temperature', label: 'حرارة', field_type: 'number' });
    expect(repo.invoke.mock.calls[0][1].p_field.scope).toBe('operation');
  });
  it('rejects an invalid phone before a managed write and accepts optional/local/international/Arabic numbers', async () => {
    const repo = { create: vi.fn() }; const service = new AomsService(repo);
    await expect(service.saveOperator({ name: 'QA', phone: 'NOT-A-PHONE' })).rejects.toThrow('رقم هاتف');
    expect(repo.create).not.toHaveBeenCalled();
    for (const phone of ['', '0591234567', '+970 591-234-567', '٠٥٩١٢٣٤٥٦٧']) expect(operatorErrors({ name: 'QA', phone })).toEqual({});
    await service.saveOperator({ name: 'QA', phone: '٠٥٩١٢٣٤٥٦٧' }); expect(repo.create.mock.calls[0][1].phone).toBe('0591234567');
  });
  it('invalid quantity/date/reading failures are raised before the managed repository call', () => {
    const repo = { invoke: vi.fn() }; const service = new AomsService(repo);
    expect(() => service.saveFuel({ asset_id: 'a', transaction_date: '2026-01-01', quantity: -1 })).toThrow('الكمية');
    expect(() => service.saveOperation({ asset_id: 'a', operation_date: '2026-01-01', previous_reading: 5, current_reading: 4 })).toThrow('القراءة الحالية');
    expect(repo.invoke).not.toHaveBeenCalled();
  });
  it('recent events sorts before limiting, respects asset/date filters, and never mutates the source', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({ id: String(i), asset_id: i % 2 ? 'a' : 'b', created_at: `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z` }));
    expect(recentEvents(events).map(e => e.id)).toEqual(['8', '7', '6', '5', '4', '3']);
    expect(recentEvents(events, { assetIds: new Set(['a']), from: '2026-10-15' }).map(e => e.id)).toEqual(['7', '5']);
    expect(events[0].id).toBe('0');
  });
  it('timestamps follow Jerusalem including summer/winter offsets, invalid values and a bad setting', () => {
    expect(businessDateTime('2026-10-29T02:09:23Z')).toBe('2026-10-29 04:09:23');
    expect(businessDateTime('2026-07-01T02:09:23Z')).toBe('2026-07-01 05:09:23');
    expect(businessDateTime('bad')).toBe('—');
    expect(businessTimeZone({ app_settings: [{ key: 'business_timezone', value: 'bad' }] })).toBe('Asia/Jerusalem');
  });
  it('business day changes at Jerusalem midnight independent of the machine timezone', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T22:15:00Z'));
    try { expect(localTodayISO()).toBe('2026-10-30'); } finally { vi.useRealTimers(); }
  });
  it('audit actor falls back to the original identifier and changed fields include values beyond 120 chars', () => {
    const before = { notes: 'ن'.repeat(300), quantity: 10 }; const after = { ...before, quantity: 12 };
    expect(auditChanges(before, after)).toEqual(['quantity']);
    expect(auditActor({ user_id: 'u' }, [{ id: 'u', full_name: 'مدير الاختبار' }])).toBe('مدير الاختبار');
    expect(auditActor({ user_id: 'u' }, [])).toBe('u');
  });
});
