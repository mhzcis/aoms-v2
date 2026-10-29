// Regression tests for defects fixed during the Oct-2026 zero-trust audit.
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AomsService } from './aomsService';
import { arrayBufferToBase64 } from '../assets/fonts/amiriFontData';

const saved = [];
vi.mock('jspdf', async importOriginal => {
  const real = await importOriginal();
  class TestPDF extends real.jsPDF {
    save(name) { saved.push(name); return this; }
  }
  return { ...real, jsPDF: TestPDF, default: TestPDF };
});

const fontsDir = path.resolve(__dirname, '../../public/fonts');
const fsFetch = vi.fn(async url => {
  const file = path.join(fontsDir, path.basename(url));
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

describe('Amiri PDF fonts (were referenced but missing → build failure)', () => {
  it('ships both Amiri TTF files with their OFL licence', () => {
    for (const f of ['Amiri-Regular.ttf', 'Amiri-Bold.ttf', 'OFL.txt']) expect(fs.existsSync(path.join(fontsDir, f))).toBe(true);
    const head = fs.readFileSync(path.join(fontsDir, 'Amiri-Regular.ttf')).subarray(0, 4);
    expect([...head]).toEqual([0, 1, 0, 0]); // TrueType magic
  });

  it('arrayBufferToBase64 round-trips large binaries (chunked)', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 7) % 256);
    expect(Buffer.from(arrayBufferToBase64(bytes.buffer), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });

  it('loadAmiriFonts reports a clear Arabic error on 404, then loads and caches the fonts', async () => {
    vi.resetModules();
    const mod = await import('../assets/fonts/amiriFontData');
    await expect(mod.loadAmiriFonts(async () => ({ ok: false, status: 404 }), '/x/')).rejects.toThrow(/تعذر تحميل خط PDF/);
    const a = await mod.loadAmiriFonts(fsFetch, '/base/');
    expect(fsFetch).toHaveBeenCalledWith('/base/fonts/Amiri-Regular.ttf');
    expect(a.amiriRegular.length).toBeGreaterThan(100000);
    const calls = fsFetch.mock.calls.length;
    expect(await mod.loadAmiriFonts(fsFetch, '/base/')).toBe(a);
    expect(fsFetch.mock.calls.length).toBe(calls);
  });

  it('exportAomsPDF (async, lazy jspdf) embeds Amiri and returns a real PDF', async () => {
    const { loadAmiriFonts } = await import('../assets/fonts/amiriFontData');
    const fonts = await loadAmiriFonts(fsFetch, '/base/');
    const { exportAomsPDF } = await import('./aomsReportService');
    const report = { type: 'operations', columns: [{ key: 'asset_code', label: 'الأصل' }, { key: 'notes', label: 'ملاحظات' }],
      rows: [{ asset_code: 'GEN-0001', notes: 'تشغيل يومي' }], summary: {} };
    const doc = await exportAomsPDF(report, 'تقرير', 'الكل', fonts);
    expect(saved).toHaveLength(0); // node: no window → returns the document without triggering a download
    expect(Object.keys(doc.getFontList())).toContain('Amiri');
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(10000);
  });

  it('REPORT-011: table cells and header lines use logical-RTL bidi (no reversed Arabic, mirrored brackets)', async () => {
    const { loadAmiriFonts } = await import('../assets/fonts/amiriFontData');
    const fonts = await loadAmiriFonts(fsFetch, '/base/');
    const { exportAomsPDF, PDF_RTL_TEXT_OPTIONS } = await import('./aomsReportService');
    const { jsPDF } = await import('jspdf');
    const cell = 'المحطة'; // single word → one line even in a narrow column
    const report = { type: 'operations', rows: [{ asset_name: cell, notes: cell }], summary: {} };
    const raw = (await exportAomsPDF(report, 'تقرير (اختبار)', 'الكل', fonts)).output();
    const out=[...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m=>{try{return inflateSync(Buffer.from(m[1],'latin1')).toString('latin1');}catch{return m[1];}}).join('\n');
    // Reference glyph run for the same string drawn with explicit logical-RTL options vs. autotable's default options.
    const glyphs = opts => {
      const ref = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });
      ref.addFileToVFS('Amiri-Regular.ttf', fonts.amiriRegular);
      ref.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
      ref.setFont('Amiri', 'normal');
      ref.text(cell, 500, 100, opts);
      return ref.output().match(/<([0-9a-fA-F]+)> Tj/)[1];
    };
    const good = glyphs({ ...PDF_RTL_TEXT_OPTIONS });
    const buggy = glyphs({ isInputVisual: false, isInputRtl: false, isSymmetricSwapping: false });
    expect(good).not.toBe(buggy); // the test discriminates between the two renderings
    expect(out).toContain(`<${good}> Tj`);
    expect(out).not.toContain(`<${buggy}> Tj`);
  });
});

describe('AomsService ↔ real schema', () => {
  // writes require navigator.onLine; an earlier PDF test in this file can leave a navigator without
  // onLine behind (order/env dependent — failed under Node 22 with VITE_* set, as in CI)
  beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));
  afterEach(() => vi.unstubAllGlobals());
  const repo = () => ({ upsert: vi.fn(async (t, p) => p), update: vi.fn(async (t, id, p) => ({ id, ...p })), insert: vi.fn() });

  it('saveSetting upserts app_settings on its primary key `key` (table has no id column)', async () => {
    const r = repo();
    await new AomsService(r).saveSetting('org_name', { ar: 'المحطة' });
    expect(r.upsert).toHaveBeenCalledWith('app_settings', { key: 'org_name', value: { ar: 'المحطة' } }, 'key');
  });

  it('saveProfile never inserts a profile without an auth user (invite flow) and updates existing ones', async () => {
    const r = repo();
    const s = new AomsService(r);
    await expect(s.saveProfile({ full_name: 'جديد', role: 'operator' })).rejects.toThrow(/Supabase Auth/);
    expect(r.insert).not.toHaveBeenCalled();
    await s.saveProfile({ id: 'u1', full_name: ' أحمد ', role: 'operator', status: 'active' });
    expect(r.update).toHaveBeenCalledWith('profiles', 'u1', { full_name: 'أحمد', role: 'operator', status: 'active' });
  });
});
