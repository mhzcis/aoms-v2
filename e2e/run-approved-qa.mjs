import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const base = process.env.QA_URL || 'http://127.0.0.1:5173/e2e/qa-fixture.html';
const out = process.env.QA_OUT || '/tmp/aoms-approved-qa';
fs.mkdirSync(out, { recursive: true });
const server = process.env.QA_URL ? null : await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true }, logLevel: 'error' });
if (server) await server.listen();
const browser = await chromium.launch({ headless: true });
let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS BROWSER-QA-${passed}: ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.error(`FAIL ${name}: ${e.message}`); }
}
async function fixture({ pageName = '/', role = 'admin', width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ar', reducedMotion: 'reduce' });
  // The fixture cannot reach the live application/backend by accident.
  await context.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}?role=${role}&page=${encodeURIComponent(pageName)}`);
  await page.getByRole('heading', { level: 4 }).first().waitFor();
  return { page, context, errors };
}
try {
  await check('reports: all events includes fuel/chlorine/operations and selected asset fields', async () => {
    const { page, context, errors } = await fixture({ pageName: '/reports' });
    await page.getByRole('combobox', { name: 'نوع الحدث', exact: true }).click();
    await page.getByRole('option', { name: 'جميع الأحداث', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="report-summary"]')?.textContent.includes('إجمالي السجلات: 3'));
    assert.ok((await page.getByRole('main').innerText()).includes('QA-DYNAMIC-TOKEN'));
    assert.deepEqual(errors, []); await page.screenshot({ path: `${out}/reports-desktop.png` }); await context.close();
  });
  await check('reports: missing scope disables all exports and displays the reason', async () => {
    const { page, context } = await fixture({ pageName: '/reports' });
    await page.getByRole('combobox', { name: 'نطاق التقرير', exact: true }).click();
    await page.getByRole('option', { name: 'أصل واحد', exact: true }).click();
    await page.getByText('اختر أصلًا لعرض التقرير', { exact: true }).waitFor();
    for (const name of ['تصدير CSV', 'طباعة / PDF', 'تصدير Excel']) assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true);
    await context.close();
  });
  await check('reports: reversed date range is explained before export', async () => {
    const { page, context } = await fixture({ pageName: '/reports' });
    await page.getByLabel('من تاريخ', { exact: true }).fill('2026-10-29');
    await page.getByLabel('إلى تاريخ', { exact: true }).fill('2026-10-01');
    await page.getByText('تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'تصدير CSV', exact: true }).isDisabled(), true); await context.close();
  });
  await check('report exports: CSV, Excel and Arabic PDF produce downloadable files', async () => {
    const { page, context, errors } = await fixture({ pageName: '/reports' });
    for (const [label, file] of [['تصدير CSV', 'report.csv'], ['تصدير Excel', 'report.xlsx'], ['طباعة / PDF', 'report.pdf']]) {
      const promise = page.waitForEvent('download', { timeout: 30000 });
      await page.getByRole('button', { name: label, exact: true }).click();
      const download = await promise; await download.saveAs(`${out}/${file}`);
      const bytes = fs.readFileSync(`${out}/${file}`); assert.ok(bytes.length > 100);
      if (file.endsWith('pdf')) assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
      if (file.endsWith('csv')) assert.ok(bytes.toString().includes('Asia/Jerusalem'));
    }
    assert.deepEqual(errors, []); await context.close();
  });
  await check('dynamic scope has one operation option', async () => {
    const { page, context } = await fixture({ pageName: '/categories' });
    await page.getByRole('button', { name: 'إضافة حقل ديناميكي', exact: true }).click();
    await page.getByRole('combobox', { name: 'نطاق الحقل', exact: true }).click();
    assert.equal(await page.getByRole('option').count(), 2); await context.close();
  });
  await check('audit: complete payload beyond 120 chars, actor identity and changed quantity', async () => {
    const { page, context, errors } = await fixture({ pageName: '/timeline_events' });
    await page.getByRole('tab', { name: 'سجل التدقيق الإداري (Audit Before / After)', exact: true }).click();
    await page.getByRole('button', { name: 'عرض تفاصيل التدقيق 00000000-0000-4000-8000-000000000099', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes('QA admin'));
    assert.ok((await dialog.locator('pre').nth(1).innerText()).includes('"quantity": 12'));
    assert.ok((await dialog.locator('pre').nth(0).innerText()).length > 300);
    await page.screenshot({ path: `${out}/audit-desktop.png` }); assert.deepEqual(errors, []); await context.close();
  });
  await check('operator form rejects bad phone and blank name with visible field feedback', async () => {
    const { page, context } = await fixture({ pageName: '/operators' });
    await page.getByRole('button', { name: 'إضافة مشغل', exact: true }).click();
    const dialog = page.getByRole('dialog'); assert.equal(await dialog.getByRole('button', { name: 'حفظ', exact: true }).isDisabled(), true);
    await page.getByLabel('اسم المشغل *', { exact: true }).fill('QA جديد');
    await page.getByLabel('رقم الهاتف', { exact: true }).fill('NOT-A-PHONE');
    assert.equal(await dialog.getByRole('button', { name: 'حفظ', exact: true }).isDisabled(), true);
    assert.ok((await dialog.innerText()).includes('7 إلى 15'));
    await page.getByLabel('رقم الهاتف', { exact: true }).fill('0591234567');
    assert.equal(await dialog.getByRole('button', { name: 'حفظ', exact: true }).isDisabled(), false); await context.close();
  });
  await check('operation validation: rejected reading shows persistent Arabic feedback', async () => {
    const { page, context, errors } = await fixture({ pageName: '/operation_logs' });
    await page.getByLabel('القراءة الحالية (ساعة تشغيل) *', { exact: true }).fill('99');
    await page.getByRole('button', { name: 'حفظ سجل التشغيل', exact: true }).click();
    await page.getByText('القراءة الحالية لا تقل عن السابقة في السجل اليومي', { exact: true }).first().waitFor();
    assert.deepEqual(errors, []); await context.close();
  });
  await check('dashboard latest event is ordered before slicing', async () => {
    const { page, context } = await fixture();
    const section = page.getByRole('heading', { name: 'أحدث الأحداث التشغيلية', exact: true }).locator('..');
    assert.ok((await section.locator('..').innerText()).includes('QA أحدث حدث')); await context.close();
  });
  await check('per-page search does not leak from assets into categories', async () => {
    const { page, context } = await fixture({ pageName: '/assets' });
    await page.getByLabel('بحث بالكود أو الاسم أو الموقع', { exact: true }).fill('absent-term');
    await page.getByRole('link').filter({ hasText: 'التصنيفات والحقول' }).click();
    assert.equal(await page.getByLabel('بحث في التصنيفات', { exact: true }).inputValue(), ''); await context.close();
  });
  for (const role of ['viewer', 'operator']) await check(`${role}: direct users/backup routes denied`, async () => {
    for (const pageName of ['/users', '/backup']) {
      const { page, context } = await fixture({ role, pageName: '/' });
      await page.goto(`${base}?role=${role}&page=${encodeURIComponent(pageName)}`);
      await page.getByText(pageName === '/users' ? 'هذه الصفحة مخصصة لمدير النظام فقط.' : 'النسخ الاحتياطي والاستعادة متاحان لمدير النظام فقط.', { exact: true }).waitFor(); await context.close();
    }
  });
  await check('offline: operational save is disabled, cached rows remain readable, reconnect recovers', async () => {
    const { page, context } = await fixture({ pageName: '/operation_logs' });
    await context.setOffline(true); await page.getByText(/جميع عمليات الإضافة والتعديل والحذف والاستعادة معطلة/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'حفظ سجل التشغيل', exact: true }).isDisabled(), true);
    assert.ok((await page.getByRole('table').innerText()).includes('مشغل QA'));
    await context.setOffline(false); await page.getByRole('button', { name: 'حفظ سجل التشغيل', exact: true }).waitFor(); await context.close();
  });
  for (const width of [360, 390, 768]) await check(`RTL/mobile ${width}px: navigation, content fit and labelled touch targets`, async () => {
    const { page, context, errors } = await fixture({ pageName: '/reports', width });
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    await page.getByRole('button', { name: 'فتح القائمة', exact: true }).click();
    await page.getByRole('link').filter({ hasText: 'الأصول والمعدات' }).click();
    await page.getByRole('heading', { name: 'الأصول والمعدات', exact: true }).waitFor();
    const w = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(w.scroll <= w.client + 1, JSON.stringify(w));
    assert.ok(await page.getByRole('button', { name: /^تعديل الأصل/ }).count());
    await page.screenshot({ path: `${out}/mobile-${width}.png`, fullPage: true }); assert.deepEqual(errors, []); await context.close();
  });
  console.log(JSON.stringify({ passed, failures, backend: 'in-memory domain engine; SQL tested separately', auth: 'test fixture profiles; no live login', real_mobile_device: false }));
  if (failures.length) process.exitCode = 1;
} finally { await browser.close(); if (server) await server.close(); }
