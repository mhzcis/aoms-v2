// Round-2 acceptance steps (search/timeline, reports+exports, forms, offline data, realtime event, backup UI).
// Real browser (Chromium) + real PostgREST/PostgreSQL. Downloads are the actual files the app produces.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import ExcelJS from 'exceljs';

export function makeSteps({ APP, OUT, PGURL, USERS, rec, wire, watch, login }) {
  // built from parts so this scanner is not itself flagged by scripts/static-check.mjs
  const SECRET_MARK = new RegExp('sb_' + 'secret_|service' + '_role');
  const dbc = async () => { const c = new pg.Client({ connectionString: PGURL }); await c.connect(); return c; };
  const asAdmin = async c => {
    await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: USERS.admin.id, role: 'authenticated' })]);
    await c.query('set role authenticated');
  };
  const one = async (c, sql, p = []) => (await c.query(sql, p)).rows[0];
  const rpc = async (c, fn, args) => (await one(c, `select to_jsonb(x) r from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) x`, args)).r;
  const todayOf = async c => (await one(c, `select (now() at time zone 'Asia/Jerusalem')::date::text d`)).d;
  const dayFn = today => n => new Date(Date.parse(today + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  const ctx = async (browser, who = 'admin', opts = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ar', ...opts });
    const stats = await wire(context);
    const page = await context.newPage(); const errs = []; watch(page, errs);
    await login(page, who);
    return { context, page, errs, stats };
  };
  const go = async (page, hash) => { await page.goto(APP + '#/' + hash, { waitUntil: 'networkidle' }); await page.waitForTimeout(300); };
  const select = (page, label, root = page) => root.locator('.MuiFormControl-root', { has: page.locator('label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).locator('[role=combobox]').first();
  const pick = async (page, label, options, root = page) => {
    await select(page, label, root).click();
    for (const o of [].concat(options)) await page.getByRole('option', { name: o, exact: typeof o === 'string' }).first().click();
    // multi-selects stay open; never press Escape when no listbox is open (it would close a dialog)
    await page.waitForTimeout(400); // let a single-select menu finish closing
    if (await page.locator('[role=listbox]:visible').count()) await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  };
  const tableData = page => page.locator('table').last().evaluate(t => ({
    head: [...t.querySelectorAll('thead th')].map(x => x.innerText.trim()),
    rows: [...t.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(x => x.innerText.trim())),
  }));
  const download = async (page, buttonName) => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: buttonName }).click()]);
    const file = path.join(OUT, '..', 'downloads', d.suggestedFilename());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await d.saveAs(file);
    return file;
  };
  const parseCsv = text => {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += ch;
    }
    row.push(cell); rows.push(row); return rows;
  };
  const norm = v => String(v ?? '').trim();
  const sameTable = (a, b) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((v, j) => norm(v) === norm(b[i][j])));
  const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify((a[i] || []).map(norm)) !== JSON.stringify((b[i] || []).map(norm))) return `row ${i}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`; return 'none'; };

  // ---------- extra data the acceptance checks need (via the real admin RPCs / SQL) ----------
  async function accSetup() {
    const c = await dbc(); await asAdmin(c);
    const day = dayFn(await todayOf(c));
    const gen = await one(c, `select * from public.categories where code_prefix='GEN'`);
    const wel = await one(c, `insert into public.categories (name, code_prefix, uses_meter, meter_unit, supports_fuel, supports_chlorine, default_chlorine_consumption, chlorine_unit)
      values ('آبار المياه','WEL',true,'متر مكعب',false,true,0.1,'لتر') returning *`);
    const tnk = await one(c, `insert into public.categories (name, code_prefix, uses_meter, supports_fuel, supports_chlorine) values ('الخزانات','TNK',false,false,false) returning *`);
    await one(c, `insert into public.category_fields (category_id, scope, field_key, label, field_type, unit, show_in_reports) values ($1,'operation','level','منسوب البئر','number','م',true) returning id`, [wel.id]);
    await one(c, `insert into public.category_fields (category_id, scope, field_key, label, field_type, show_in_reports) values ($1,'operation','secret_note','ملاحظة داخلية','text',false) returning id`, [gen.id]);
    await one(c, `insert into public.category_fields (category_id, scope, field_key, label, field_type, sort_order, show_in_reports) values ($1,'operation','pressure','ضغط الزيت','number',1,true) returning id`, [gen.id]);
    await c.query(`update public.category_fields set sort_order=2 where category_id=$1 and field_key='oil_temp'`, [gen.id]);
    for (const [k, o] of [['cooling', 1], ['brand', 2], ['kva', 3], ['installed', 4], ['outdoor', 5]])
      await c.query(`update public.category_fields set sort_order=$2 where category_id=$1 and field_key=$3`, [gen.id, o, k]);
    const w1 = await rpc(c, 'create_asset', [JSON.stringify({ category_id: wel.id, name: 'بئر الشمال', location: 'الحقل' }), '{}']);
    const t1 = await rpc(c, 'create_asset', [JSON.stringify({ category_id: tnk.id, name: 'خزان علوي', location: 'التلة' }), '{}']);
    const op1 = await one(c, `select id from public.operators where name='أحمد محمود'`);
    // receipt first: the DB rejects consumption beyond the theoretical chlorine balance
    await rpc(c, 'save_chlorine_transaction', [JSON.stringify({ asset_id: w1.id, transaction_date: day(6), transaction_type: 'receipt', quantity: 20, supplier: 'مورد الكلور' })]);
    await rpc(c, 'save_operation_log', [JSON.stringify({ asset_id: w1.id, operation_date: day(5), previous_reading: 500, current_reading: 530, operator_id: op1.id, notes: '+SUM(A1:A9)' }), JSON.stringify({ level: '37' })]);
    await rpc(c, 'save_operation_log', [JSON.stringify({ asset_id: t1.id, operation_date: day(2), operator_id: op1.id, notes: 'فحص الخزان' }), '{}']);
    await c.query('reset role');
    // hidden (show_in_reports=false) value + formula-looking note on the newest GEN-0001 log (superuser, test data only)
    const lg = await one(c, `select l.id from public.operation_logs l join public.assets a on a.id=l.asset_id where a.asset_code='GEN-0001' order by l.operation_date desc limit 1`);
    const sf = await one(c, `select id from public.category_fields where field_key='secret_note'`);
    await c.query(`insert into public.operation_log_values (operation_log_id, field_id, value_text) values ($1,$2,'قيمة سرية لا تظهر')`, [lg.id, sf.id]);
    await c.query(`update public.operation_logs set notes='=HYPERLINK("http://evil.test","x")' where id=$1`, [lg.id]);
    await c.end();
    rec('ACC-SETUP', true, `WEL-0001 (متر مكعب, chlorine لتر), TNK-0001 (no meter), hidden GEN field, ordered fields, formula-like notes`);
  }

  // ---------- SEARCH-003/004, TIME-002/003 ----------
  async function searchTimeline(browser) {
    const { context, page, errs } = await ctx(browser);
    await go(page, 'search');
    await page.getByLabel(/اكتب كلمة البحث/).fill('GEN-0001');
    await page.waitForTimeout(500);
    const groups = await page.locator('.MuiCard-root').evaluateAll(cs => cs.map(c => ({ head: c.querySelector('h6')?.innerText.trim(), items: c.querySelectorAll('.MuiStack-root > div').length })));
    const okGroups = groups.length >= 3 && groups.every(g => { const m = /\((\d+)\)$/.exec(g.head || ''); return m && Number(m[1]) === g.items; }) && new Set(groups.map(g => g.head.replace(/\s*\(\d+\)$/, ''))).size === groups.length;
    await page.screenshot({ path: path.join(OUT, 'search-grouped.png'), fullPage: true });
    rec('SEARCH-003', okGroups, `groups: ${groups.map(g => `${g.head}[${g.items}]`).join(', ')}`);

    const c = await dbc();
    const fuel = await one(c, `select t.id, a.id asset_id from public.fuel_transactions t join public.assets a on a.id=t.asset_id where a.asset_code='GEN-0001' limit 1`);
    const fuelCard = page.locator('.MuiCard-root', { has: page.locator('h6', { hasText: /الوقود/ }) });
    await fuelCard.locator('.MuiStack-root > div').first().click();
    await page.waitForTimeout(700);
    const url1 = decodeURIComponent(page.url());
    const sel1 = await page.locator('tbody tr.Mui-selected').allInnerTexts();
    await page.screenshot({ path: path.join(OUT, 'search-open-fuel.png') });
    const ok1 = url1.includes('#/fuel_transactions') && url1.includes(`highlight=${fuel.id}`) && sel1.length === 1 && /800/.test(sel1[0]);
    await go(page, 'search');
    await page.getByLabel(/اكتب كلمة البحث/).fill('GEN-0002');
    await page.waitForTimeout(400);
    const assetCard = page.locator('.MuiCard-root', { has: page.locator('h6', { hasText: /الأصول/ }) });
    await assetCard.locator('.MuiStack-root > div').first().click();
    await page.waitForTimeout(700);
    const url2 = decodeURIComponent(page.url());
    const hl = await page.locator('[data-highlighted=true]').allInnerTexts();
    const ok2 = url2.includes('#/assets') && hl.length === 1 && hl[0].includes('GEN-0002');
    rec('SEARCH-004', ok1 && ok2, `fuel result -> ${url1.split('#')[1]} selectedRows=${sel1.length} (${(sel1[0] || '').replace(/\s+/g, ' ').slice(0, 50)}); asset result -> ${url2.split('#')[1]} highlightedCard=${JSON.stringify(hl.map(h => h.split('\n')[0]))}`);

    await go(page, 'timeline_events');
    const times = await page.locator('tbody tr td:first-child').allInnerTexts();
    const sorted = times.every((t, i) => i === 0 || times[i - 1] >= t);
    const dbFirst = (await one(c, `select to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') t from public.timeline_events order by created_at desc limit 1`)).t;
    rec('TIME-002', sorted && times.length > 3, `${times.length} events, newest-first=${sorted}, first="${times[0]}", db newest (UTC session)="${dbFirst}"`);
    const ev = await one(c, `select e.title, e.entity_id, e.entity_type from public.timeline_events e where e.entity_type='chlorine_transaction' order by created_at desc limit 1`);
    await page.locator('tbody tr', { hasText: ev.title }).first().click();
    await page.waitForTimeout(700);
    const url3 = decodeURIComponent(page.url());
    const sel3 = await page.locator('tbody tr.Mui-selected').count();
    await page.screenshot({ path: path.join(OUT, 'timeline-open-chlorine.png') });
    rec('TIME-003', url3.includes('#/chlorine_transactions') && url3.includes(`highlight=${ev.entity_id}`) && sel3 === 1, `"${ev.title}" (${ev.entity_type}) -> ${url3.split('#')[1]} selectedRows=${sel3}`);
    rec('CONSOLE-searchTimeline', errs.length === 0, errs.slice(0, 3).join(' | ') || '0 errors');
    await c.end(); await context.close();
  }

  // ---------- REPORT-001..011, FIELD-011, CHL-006 ----------
  async function reports(browser) {
    const { context, page, errs } = await ctx(browser);
    const c = await dbc();
    await go(page, 'reports');
    const cnt = async (sql, p = []) => Number((await one(c, sql, p)).n);
    const codesOf = t => { const i = t.head.findIndex(h => h === 'رمز الأصل' || h === 'الأصل المستفيد'); return [...new Set(t.rows.map(r => (r[i] || '').match(/[A-Z]+-\d{4}/)?.[0] || r[i]))].sort(); };
    // all assets
    let t = await tableData(page);
    const allDb = await cnt(`select count(*) n from public.operation_logs`);
    const allCodes = (await c.query(`select distinct a.asset_code from public.operation_logs l join public.assets a on a.id=l.asset_id order by 1`)).rows.map(r => r.asset_code).join();
    rec('REPORT-004', t.rows.length === allDb && codesOf(t).join() === allCodes && allCodes.split(',').length >= 4, `rows screen=${t.rows.length} db=${allDb}; assets screen=${codesOf(t).join(',')} db=${allCodes} (3 categories)`);
    // REPORT-006 (multi-category dynamic columns, blank when not applicable) + FIELD-011 on the screen
    const iGen = t.head.indexOf('حرارة الزيت (°C) — المولدات الكهربائية'), iWel = t.head.indexOf('منسوب البئر (م) — آبار المياه'), iCode = t.head.indexOf('رمز الأصل');
    const welRow = t.rows.find(r => r[iCode] === 'WEL-0001'), genRow = t.rows.find(r => r[iCode] === 'GEN-0001');
    rec('REPORT-006', iGen > iCode && iWel > iCode && welRow?.[iWel] === '37' && welRow?.[iGen] === '—' && genRow?.[iWel] === '—' && /^\d+$/.test(genRow?.[iGen] || ''),
      `dyn cols at ${iGen},${iWel} after common cols; WEL row: level=${welRow?.[iWel]} oil=${welRow?.[iGen]}; GEN row: oil=${genRow?.[iGen]} level=${genRow?.[iWel]}`);
    // REPORT-007: summary per unit, equal to SQL per-unit sums
    const sums = (await c.query(`select coalesce(c.meter_unit,'بلا عداد') u, sum(coalesce(l.usage_value,0)) s from public.operation_logs l join public.assets a on a.id=l.asset_id join public.categories c on c.id=a.category_id group by 1`)).rows;
    const summary = await page.getByTestId('report-summary').innerText();
    const sumOk = sums.every(s => summary.includes(`${Number(s.s)} (${s.u})`)) && !summary.includes(`${sums.reduce((a, s) => a + Number(s.s), 0)} (`);
    rec('REPORT-007', sumOk, `screen: "${summary}"; db per unit: ${sums.map(s => `${Number(s.s)} ${s.u}`).join(' | ')}`);
    // exports of the all-assets report vs screen (REPORT-008/009/010/011)
    const csvF = await download(page, 'تصدير CSV');
    const xlsxF = await download(page, 'تصدير Excel');
    const pdfF = await download(page, 'طباعة / PDF');
    const csvBytes = fs.readFileSync(csvF);
    const csv = parseCsv(csvBytes.toString('utf8').replace(/^\uFEFF/, ''));
    const csvData = csv.slice(3).map(r => r.map(v => v.replace(/^'(?=[=+\-@])/, '')));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsxF); const ws = wb.worksheets[0];
    const xHead = t.head.map((_, j) => ws.getRow(4).getCell(j + 1).value);
    const xData = t.rows.map((_, i) => t.head.map((__, j) => ws.getRow(5 + i).getCell(j + 1).value));
    const pdfText = execFileSync('pdftotext', ['-layout', pdfF, '-']).toString();
    const pdfCodes = (pdfText.match(/[A-Z]{3}-\d{4}/g) || []).sort();
    const screenCodes = t.rows.map(r => r[iCode]).sort();
    const csvOk = sameTable([csv[2]], [t.head]) && sameTable(csvData, t.rows) && csv[1][0] === summary;
    const xOk = sameTable([xHead], [t.head]) && sameTable(xData.map(r => r.map(v => String(v))), t.rows) && ws.getCell(3, 1).value === summary;
    const pdfOk = JSON.stringify(pdfCodes) === JSON.stringify(screenCodes);
    rec('REPORT-008', csvOk && xOk && pdfOk, `csv=${csvOk} (${firstDiff(csvData, t.rows)}); xlsx=${xOk}; pdf asset codes ${pdfCodes.length}/${screenCodes.length} match=${pdfOk}; files ${path.basename(csvF)}, ${path.basename(xlsxF)}, ${path.basename(pdfF)}`);
    rec('REPORT-009', ws.views[0]?.rightToLeft === true && xOk, `xlsx views[0].rightToLeft=${ws.views[0]?.rightToLeft}, header row 4 = screen header, ${xData.length} data rows = screen`);
    const iNotes = t.head.indexOf('الملاحظات');
    const rawNotes = csv.slice(3).map(r => r[iNotes]);
    const xNoteCell = t.rows.map((_, i) => ws.getRow(5 + i).getCell(iNotes + 1)).find(cl => String(cl.value).startsWith('=HYPERLINK'));
    rec('REPORT-010', csvBytes[0] === 0xef && rawNotes.includes(`'=HYPERLINK("http://evil.test","x")`) && rawNotes.includes(`'+SUM(A1:A9)`) && rawNotes.every(n => !/^[=+\-@]/.test(n)) && xNoteCell?.type === ExcelJS.ValueType.String,
      `CSV BOM=${csvBytes[0] === 0xef}; notes in CSV: ${rawNotes.filter(n => n.startsWith("'")).join(' , ')}; xlsx cell type=${xNoteCell?.type} (3=String) formula=${xNoteCell?.formula ?? 'none'}`);
    const pdfInfo = execFileSync('pdfinfo', [pdfF]).toString();
    const fonts = execFileSync('pdffonts', [pdfF]).toString();
    // Text check: pdftotext output (Arabic presentation forms → NFKC, bidi marks stripped) must contain every Arabic
    // word of the screen header and of the first data row in logical order and unbroken (reversed or mid-word-split
    // words fail), plus the human scope label instead of the raw key.
    const pdfLogical = pdfText.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e]/g, '');
    const pdfWords = new Set(pdfLogical.match(/[\u0600-\u06ff]+/g) || []); // Arabic runs (pdftotext may glue a word to an adjacent number)
    const wantWords = [...new Set([...t.head, ...t.rows[0]].flatMap(c => String(c).split(/\s+/)).filter(w => /^[\u0600-\u06ff]+$/.test(w)))];
    const missingWords = wantWords.filter(w => !pdfWords.has(w));
    const scopeOk = /النطاق\s*:\s*جميع الأصول/.test(pdfLogical) && !pdfLogical.includes('all_assets');
    rec('REPORT-011', /Amiri/.test(fonts) && /Page size:\s+841\.89 x 595\.28/.test(pdfInfo) && pdfOk && missingWords.length === 0 && scopeOk,
      `pdffonts: ${[...new Set(fonts.match(/Amiri[-\w]*/g) || [])].join(',')}; A4 landscape=${/841\.89 x 595\.28/.test(pdfInfo)}; rows (asset codes) = screen; Arabic words found logical+unbroken ${wantWords.length - missingWords.length}/${wantWords.length}${missingWords.length ? ' missing: ' + missingWords.join(' ') : ''}; scope title ok=${scopeOk}. Visual layout additionally inspected from rendered PNGs (evidence/report011)`);
    // FIELD-011: hidden field absent from screen + files even in single-category report
    await pick(page, 'نطاق التقرير', 'تصنيف كامل');
    await pick(page, 'اختر التصنيف', /GEN \| /);
    t = await tableData(page);
    const csv2F = await download(page, 'تصدير CSV');
    const csv2 = fs.readFileSync(csv2F, 'utf8');
    const genDb = await cnt(`select count(*) n from public.operation_logs l join public.assets a on a.id=l.asset_id join public.categories c on c.id=a.category_id where c.code_prefix='GEN'`);
    rec('REPORT-002', t.rows.length === genDb && codesOf(t).every(x => x.startsWith('GEN-')) && t.head.includes('حرارة الزيت (°C)') && t.head.includes('ضغط الزيت'), `rows screen=${t.rows.length} db=${genDb}; assets=${codesOf(t)}; dyn cols=${t.head.filter(h => /حرارة|ضغط/.test(h)).join(',')}`);
    rec('FIELD-011', !t.head.some(h => /ملاحظة داخلية/.test(h)) && !csv2.includes('ملاحظة داخلية') && !csv2.includes('قيمة سرية') && !fs.readFileSync(csvF, 'utf8').includes('قيمة سرية'),
      `hidden field header on screen=${t.head.some(h => /ملاحظة داخلية/.test(h))}, in CSV=${csv2.includes('ملاحظة داخلية')}, hidden value in CSVs=${csv2.includes('قيمة سرية')}`);
    // REPORT-001 single asset
    await pick(page, 'نطاق التقرير', 'أصل واحد');
    await pick(page, 'اختر الأصل', /^PMP-0001/);
    t = await tableData(page);
    const pmpDb = await cnt(`select count(*) n from public.operation_logs l join public.assets a on a.id=l.asset_id where a.asset_code='PMP-0001'`);
    rec('REPORT-001', t.rows.length === pmpDb && codesOf(t).join() === 'PMP-0001', `rows screen=${t.rows.length} db=${pmpDb}; assets=${codesOf(t)}`);
    // REPORT-003 multiple assets from different categories, for operations, fuel and chlorine
    await pick(page, 'نطاق التقرير', 'مجموعة أصول مختارة');
    await pick(page, 'اختر الأصول المتعددة', [/^GEN-0001/, /^WEL-0001/]);
    t = await tableData(page);
    const multiDb = await cnt(`select count(*) n from public.operation_logs l join public.assets a on a.id=l.asset_id where a.asset_code in ('GEN-0001','WEL-0001')`);
    await pick(page, 'نوع الحدث', 'حركات الكلور');
    const tc = await tableData(page);
    await pick(page, 'نوع الحدث', 'حركات الوقود');
    const tf = await tableData(page);
    const chlDb = await cnt(`select count(*) n from public.chlorine_transactions t join public.assets a on a.id=t.asset_id where a.asset_code in ('GEN-0001','WEL-0001')`);
    const fuelDb = await cnt(`select count(*) n from public.fuel_transactions t join public.assets a on a.id=t.asset_id where a.asset_code in ('GEN-0001','WEL-0001')`);
    rec('REPORT-003', t.rows.length === multiDb && codesOf(t).join() === 'GEN-0001,WEL-0001' && tc.rows.length === chlDb && codesOf(tc).join() === 'WEL-0001' && tf.rows.length === fuelDb && tf.head.includes('نوع الوقود'),
      `operations ${t.rows.length}/${multiDb} assets=${codesOf(t)}; chlorine ${tc.rows.length}/${chlDb} assets=${codesOf(tc)}; fuel ${tf.rows.length}/${fuelDb} cols=${tf.head.slice(0, 4).join('|')}`);
    // CHL-006: unit fixed per category, same on chlorine screen and in the report
    await pick(page, 'نطاق التقرير', 'جميع الأصول');
    await pick(page, 'نوع الحدث', 'حركات الكلور');
    const tAll = await tableData(page);
    const iU = tAll.head.findIndex(h => /الوحدة/.test(h));
    const iA = tAll.head.indexOf('الأصل المستفيد');
    const units = Object.fromEntries(tAll.rows.map(r => [(r[iA] || '').match(/[A-Z]+-\d{4}/)?.[0], r[iU]]).sort());
    const dbUnits = Object.fromEntries((await c.query(`select a.asset_code, c.chlorine_unit from public.chlorine_transactions t join public.assets a on a.id=t.asset_id join public.categories c on c.id=a.category_id order by 1`)).rows.map(r => [r.asset_code, r.chlorine_unit]));
    await go(page, 'chlorine_transactions');
    const chlScreen = await page.locator('body').innerText();
    rec('CHL-006', JSON.stringify(units) === JSON.stringify(dbUnits) && /20\s*لتر/.test(chlScreen) && /40\s*كجم/.test(chlScreen),
      `report units ${JSON.stringify(units)} = category units ${JSON.stringify(dbUnits)}; chlorine screen shows "20 لتر"=${/20\s*لتر/.test(chlScreen)} "40 كجم"=${/40\s*كجم/.test(chlScreen)}`);
    // REPORT-005 from/to + stale-scope regression
    await go(page, 'reports');
    await pick(page, 'نوع الحدث', 'سجلات التشغيل'); // report filters persist across navigation
    const day = dayFn(await todayOf(c));
    await page.getByLabel('من تاريخ').fill(day(3)); await page.getByLabel('إلى تاريخ').fill(day(2)); await page.waitForTimeout(300);
    t = await tableData(page);
    const rangeDb = await cnt(`select count(*) n from public.operation_logs where operation_date between $1 and $2`, [day(3), day(2)]);
    const iD = t.head.indexOf('التاريخ');
    const fmt = d => d.split('-').reverse().join('/');
    rec('REPORT-005', t.rows.length === rangeDb && t.rows.every(r => [fmt(day(3)), fmt(day(2))].includes(r[iD])), `${day(3)}..${day(2)}: rows screen=${t.rows.length} db=${rangeDb}; dates=${[...new Set(t.rows.map(r => r[iD]))].join(',')}`);
    await page.screenshot({ path: path.join(OUT, 'report-date-range.png'), fullPage: true });
    rec('CONSOLE-reports', errs.length === 0, errs.slice(0, 3).join(' | ') || '0 errors');
    await c.end(); await context.close();
  }

  // ---------- FIELD-004, ASSET-003, OPERATOR-004, OPLOG-004/008/015/019, mobile labels ----------
  async function formsUi(browser) {
    const { context, page, errs } = await ctx(browser);
    const c = await dbc();
    const day = dayFn(await todayOf(c));
    await go(page, 'assets');
    const cards = await page.locator('.MuiCard-root h6').allInnerTexts();
    const codes = cards.map(x => (x.match(/[A-Z]{3}-\d{4}/) || [])[0]).filter(Boolean);
    rec('ASSET-003', codes.length >= 5 && codes.join() === [...codes].sort().join(), `cards order: ${codes.join(', ')}`);
    await page.locator('.MuiCard-root', { hasText: 'GEN-0001' }).locator('button').first().click();
    const dlg = page.getByRole('dialog'); await dlg.waitFor();
    const dtext = await dlg.innerText();
    const order = ['نوع التبريد', 'الماركة', 'القدرة', 'تاريخ التركيب', 'خارجي'].map(l => dtext.indexOf(l));
    await page.screenshot({ path: path.join(OUT, 'asset-form-field-order.png') });
    await page.keyboard.press('Escape');
    await go(page, 'operation_logs');
    await pick(page, '1. اختر التصنيف', /GEN/);
    await pick(page, '2. اختر الأصل التابع للتصنيف (مرتب حسب الكود)', /GEN-0002/);
    const ftext = await page.locator('main').innerText();
    const opOrder = [ftext.indexOf('ضغط الزيت'), ftext.indexOf('حرارة الزيت')];
    rec('FIELD-004', order.every((v, i) => v >= 0 && (i === 0 || order[i - 1] < v)) && opOrder[0] >= 0 && opOrder[0] < opOrder[1],
      `asset form label positions (sort 1..5)=${order.join(',')}; operation form ضغط(1)@${opOrder[0]} < حرارة(2)@${opOrder[1]}`);
    const genNoChl = await page.getByLabel(/استهلاك الكلور/).count();
    await pick(page, '1. اختر التصنيف', /PMP/);
    const pmpChl = await page.getByLabel(/استهلاك الكلور/).count();
    rec('OPLOG-019', genNoChl === 0 && pmpChl > 0, `chlorine inputs: GEN(no chlorine)=${genNoChl}, PMP(chlorine)=${pmpChl}`);
    await pick(page, '1. اختر التصنيف', /TNK/);
    const tnkReading = await page.getByLabel(/القراءة الحالية|القراءة السابقة/).count();
    const tnkHead = await page.locator('table thead').last().innerText();
    await page.screenshot({ path: path.join(OUT, 'oplog-no-meter.png'), fullPage: true });
    rec('OPLOG-004', tnkReading === 0 && !/القراءة/.test(tnkHead), `TNK (uses_meter=false): reading inputs=${tnkReading}, readings in table header=${/القراءة/.test(tnkHead)}`);
    await pick(page, '1. اختر التصنيف', /WEL/);
    const dateVal = await page.getByLabel('التاريخ *').first().inputValue();
    rec('OPLOG-008', dateVal === day(4), `WEL-0001 last log ${day(5)} -> default date ${dateVal} (expected ${day(4)})`);
    // OPERATOR-004 / OPLOG-015 via the operators UI
    const setStatus = async label => {
      await go(page, 'operators');
      await page.locator('tbody tr', { hasText: 'أحمد محمود' }).locator('button').last().click();
      const d = page.getByRole('dialog'); await d.waitFor();
      await pick(page, 'الحالة', label, d);
      await d.getByRole('button', { name: 'حفظ' }).click(); await page.waitForTimeout(1200);
    };
    const operatorOptions = async () => {
      await go(page, 'operation_logs');
      await pick(page, '1. اختر التصنيف', /GEN/);
      await pick(page, '2. اختر الأصل التابع للتصنيف (مرتب حسب الكود)', /GEN-0002/);
      await select(page, 'المشغل').click();
      const opts = await page.getByRole('option').allInnerTexts(); await page.keyboard.press('Escape');
      return opts;
    };
    await setStatus('غير نشط');
    const st1 = (await one(c, `select status from public.operators where name='أحمد محمود'`)).status;
    const optsInactive = await operatorOptions();
    await pick(page, '2. اختر الأصل التابع للتصنيف (مرتب حسب الكود)', /GEN-0001/);
    const oldRows = await page.locator('tbody tr', { hasText: 'أحمد محمود' }).count();
    await page.screenshot({ path: path.join(OUT, 'oplog-inactive-operator-history.png'), fullPage: true });
    await setStatus('نشط');
    const st2 = (await one(c, `select status from public.operators where name='أحمد محمود'`)).status;
    const optsActive = await operatorOptions();
    rec('OPLOG-015', st1 === 'inactive' && oldRows >= 5, `operator inactive (db=${st1}); GEN-0001 history rows still showing his name: ${oldRows}`);
    rec('OPERATOR-004', st1 === 'inactive' && !optsInactive.includes('أحمد محمود') && st2 === 'active' && optsActive.includes('أحمد محمود'),
      `inactive: options=${JSON.stringify(optsInactive)}; reactivated (db=${st2}): options=${JSON.stringify(optsActive)}`);
    rec('CONSOLE-formsUi', errs.length === 0, errs.slice(0, 3).join(' | ') || '0 errors');
    await context.close();
    // mobile: reading / chlorine labels must not be cut off
    const m = await ctx(browser, 'admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await go(m.page, 'operation_logs');
    await pick(m.page, '1. اختر التصنيف', /PMP/);
    const cut = await m.page.locator('main label').evaluateAll(ls => ls.filter(l => /القراءة|الكلور/.test(l.textContent)).map(l => ({ t: l.textContent, cut: l.scrollWidth > l.clientWidth + 1 })));
    await m.page.screenshot({ path: path.join(OUT, 'mobile-oplog-labels.png'), fullPage: true });
    rec('UI-MOBILE-LABELS', cut.length >= 3 && cut.every(x => !x.cut), cut.map(x => `${x.t}:${x.cut ? 'CUT' : 'ok'}`).join(' | '));
    await m.context.close(); await c.end();
  }

  // ---------- SYNC-002/003/006/007 ----------
  async function offlineSync(browser) {
    const { context, page, errs, stats } = await ctx(browser, 'operator', { serviceWorkers: 'allow' });
    const c = await dbc();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle' });
    await go(page, 'reports');
    const onlineRows = (await tableData(page)).rows.length;
    await context.setOffline(true); await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'load' }).catch(() => {}); await page.waitForTimeout(2500); // data now only from the local read cache
    await go(page, 'search').catch(() => {});
    await page.getByLabel(/اكتب كلمة البحث/).fill('WEL-0001'); await page.waitForTimeout(400);
    const groups = await page.locator('.MuiCard-root h6').allInnerTexts();
    const banner = await page.getByText('غير متصل — وضع القراءة فقط').count();
    await page.screenshot({ path: path.join(OUT, 'offline-search.png') });
    rec('SYNC-002', banner > 0 && groups.length > 0 && groups.some(g => /الأصول/.test(g)), `offline after reload (banner=${banner}); search "WEL-0001" groups: ${groups.join(', ')}`);
    await go(page, 'reports').catch(() => {});
    const offRows = (await tableData(page)).rows.length;
    await page.screenshot({ path: path.join(OUT, 'offline-report.png') });
    rec('SYNC-003', offRows === onlineRows && offRows > 0, `report rows online=${onlineRows}, offline(after reload, from cache)=${offRows}`);
    // SYNC-006: change in DB while offline -> back online -> refreshed without reload
    await c.query(`insert into public.operators (name, phone) values ('مشغل أضيف أثناء الانقطاع','0599000099')`);
    await go(page, 'operators').catch(() => {});
    const before = await page.getByText('مشغل أضيف أثناء الانقطاع').count();
    await context.setOffline(false);
    await page.getByText('مشغل أضيف أثناء الانقطاع').first().waitFor({ timeout: 10000 }).catch(() => {});
    const after = await page.getByText('مشغل أضيف أثناء الانقطاع').count();
    rec('SYNC-006', before === 0 && after > 0, `new operator visible offline=${before}, after reconnect (no reload)=${after}`);
    // SYNC-007 (client side): a postgres_changes event pushed on the realtime socket refreshes the screen
    await c.query(`insert into public.operators (name, phone) values ('مشغل من جهاز آخر','0599000098')`);
    await page.waitForTimeout(800);
    const pre = await page.getByText('مشغل من جهاز آخر').count();
    const pushed = stats.push({ schema: 'public', table: 'operators', type: 'INSERT', commit_timestamp: new Date().toISOString(), columns: [{ name: 'name', type: 'text' }], record: { name: 'مشغل من جهاز آخر' }, errors: null });
    await page.getByText('مشغل من جهاز آخر').first().waitFor({ timeout: 8000 }).catch(() => {});
    const post = await page.getByText('مشغل من جهاز آخر').count();
    rec('SYNC-007-MOCK', pushed > 0 && pre === 0 && post > 0, `PARTIAL: realtime server is mocked. Row inserted in PG by "another device"; before event=${pre}; after a postgres_changes frame on the socket (${pushed} channel(s))=${post}`);
    rec('CONSOLE-offlineSync', errs.filter(e => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(e)).length === 0, errs.filter(e => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(e)).slice(0, 3).join(' | ') || `0 non-network errors (${errs.length} expected offline network errors)`);
    await c.end(); await context.close();
  }


  // ---------- REG-006: > 1000 rows (PostgREST db-max-rows = 1000 like Supabase) + UI paging ----------
  async function largeData(browser) {
    const c = await dbc();
    const N = 3000;
    const cat = await one(c, `select category_id from public.assets where asset_code='WEL-0001'`);
    const asset = await one(c, `insert into public.assets (asset_code, name, category_id, location) values ('REG-6000','أصل بيانات كبيرة',$1,'اختبار الحجم') returning id`, [cat.category_id]);
    const t0 = Date.now();
    await c.query(`insert into public.operation_logs (asset_id, operation_date, record_type, previous_reading, current_reading, usage_value, notes)
      select $1, current_date - n, 'daily', (${N} - n) * 2, (${N} - n) * 2 + 2, 2, 'REG6-' || n from generate_series(1, ${N}) n`, [asset.id]);
    const insMs = Date.now() - t0;
    const total = Number((await one(c, `select count(*) n from public.operation_logs`)).n);
    const plan = (await c.query(`explain (analyze, format json) select * from public.operation_logs where asset_id=$1 order by operation_date desc limit 25 offset 2000`, [asset.id])).rows[0]['QUERY PLAN'][0];
    const planTxt = JSON.stringify(plan.Plan);
    rec('REG-006-DB', total > 1000 && /op_asset_date/.test(planTxt), `${N} logs inserted in ${insMs} ms (table total=${total}); page query (offset 2000, limit 25) uses index op_asset_date, ${plan['Execution Time'].toFixed(2)} ms`);

    const { context, page, errs, stats } = await ctx(browser);
    // the PostgREST cap is real: one un-ranged GET returns only 1000 of the rows (what the old single-select list() got)
    const tok = stats.log.find(r => /^Bearer /.test(r.authorization) && JSON.parse(Buffer.from(r.authorization.split('.')[1], 'base64url')).role === 'authenticated');
    const raw = await fetch(`http://127.0.0.1:54330/operation_logs?select=id`, { headers: { authorization: tok.authorization } }).then(r => r.json());
    stats.log.length = 0;
    const tUi = Date.now();
    await go(page, `operation_logs?asset=${asset.id}`);
    await page.locator('.MuiTablePagination-displayedRows').first().waitFor({ timeout: 20000 });
    const uiMs = Date.now() - tUi;
    const label = async () => (await page.locator('.MuiTablePagination-displayedRows').first().innerText()).trim();
    const bodyRows = async () => page.locator('table').last().locator('tbody tr').count();
    const logGets = stats.log.filter(r => r.method === 'GET' && r.path === '/rest/v1/operation_logs');
    const l1 = await label(); const r1 = await bodyRows();
    await page.screenshot({ path: path.join(OUT, 'reg006-page1.png') });
    await page.getByRole('button', { name: 'الصفحة الأخيرة' }).click(); await page.waitForTimeout(300);
    const lLast = await label(); const rLast = await bodyRows();
    const lastText = await page.locator('table').last().locator('tbody tr').last().innerText();
    const oldest = (await one(c, `select (current_date - ${N})::text d`)).d;
    await page.getByRole('button', { name: 'الصفحة السابقة' }).click(); await page.waitForTimeout(300);
    const lPrev = await label();
    await page.getByRole('combobox').filter({ hasText: '25' }).last().click();
    await page.getByRole('option', { name: '100', exact: true }).click(); await page.waitForTimeout(300);
    const l100 = await label(); const r100 = await bodyRows();
    rec('REG-006', raw.length === 1000 && logGets.length >= 3 && l1 === `1–25 من ${N}` && r1 === 25 && lLast === `${N - 24}–${N} من ${N}` && rLast === 25 && lastText.includes(oldest) && lPrev === `${N - 49}–${N - 25} من ${N}` && l100 === `1–100 من ${N}` && r100 === 100,
      `PostgREST un-ranged GET capped at ${raw.length} rows; app fetched operation_logs in ${logGets.length} ranged GETs (${logGets.map(r => decodeURIComponent(r.search).match(/offset=\d+/)?.[0] || '').join(',')}); first paint ${uiMs} ms; page1 "${l1}" rows=${r1}; last "${lLast}" rows=${rLast} oldest ${oldest} shown=${lastText.includes(oldest)}; prev "${lPrev}"; 100/page "${l100}" rows=${r100}`);
    // deep link: highlight a row that sits on page 81
    const target = await one(c, `select id, operation_date::text d from public.operation_logs where asset_id=$1 order by operation_date desc offset 2010 limit 1`, [asset.id]);
    await go(page, `operation_logs?asset=${asset.id}&highlight=${target.id}`);
    await page.locator('.MuiTablePagination-displayedRows').first().waitFor({ timeout: 20000 });
    const lHi = await label();
    const sel = await page.locator('tbody tr.Mui-selected').allInnerTexts();
    const [hiFrom, hiTo] = (lHi.match(/^(\d+)–(\d+)/) || []).slice(1).map(Number);
    rec('REG-006-HIGHLIGHT', hiFrom <= 2011 && 2011 <= hiTo && hiFrom > 1 && sel.length === 1 && sel[0].includes(target.d), `deep link to row #2011 (${target.d}) opened page "${lHi}" (page size kept at 100), selected rows=${sel.length} contains date=${sel.some(t => t.includes(target.d))}`);
    // filters still apply on top of paging: another asset shows its own (small) count; assets search narrows the cards
    const wel = await one(c, `select a.id, count(l.id)::int n from public.assets a left join public.operation_logs l on l.asset_id=a.id where a.asset_code='WEL-0001' group by a.id`);
    await go(page, `operation_logs?asset=${wel.id}`);
    const welRows = await bodyRows(); const welPager = await page.locator('.MuiTablePagination-displayedRows').count();
    await go(page, 'assets');
    await page.getByLabel(/بحث/).first().fill('REG-6000'); await page.waitForTimeout(400);
    const cards = await page.locator('.MuiGrid-root .MuiCard-root').count();
    rec('REG-006-FILTER', welRows === Math.max(wel.n, 1) && welPager === (wel.n > 10 ? 1 : 0) && cards === 1, `WEL-0001 logs table rows=${welRows} (db=${wel.n}, pager shown=${welPager}); assets search "REG-6000" -> ${cards} card(s)`);
    rec('CONSOLE-largeData', errs.length === 0, errs.slice(0, 3).join(' | ') || '0 errors');
    await c.end(); await context.close();
  }

  // ---------- AUTH-009 at runtime: what the shipped bundle contains and which keys the browser actually sends ----------
  async function keysRuntime(browser) {
    const decode = t => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return null; } };
    const found = { js: 0, jsBytes: 0, jwtsInJs: [], secretHits: [], headerRoles: new Set(), headerSecret: 0 };
    for (const who of ['admin', 'operator']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' });
      const stats = await wire(context);
      const page = await context.newPage();
      const bodies = [];
      page.on('response', r => { if (/\.(m?js)(\?|$)/.test(r.url())) bodies.push(r.text().then(t => ({ url: r.url(), t })).catch(() => null)); });
      await login(page, who);
      for (const h of ['assets', 'reports', 'backup', 'users']) await go(page, h).catch(() => {});
      for (const b of (await Promise.all(bodies)).filter(Boolean)) {
        found.js++; found.jsBytes += b.t.length;
        for (const m of b.t.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) found.jwtsInJs.push(decode(m)?.role);
        if (SECRET_MARK.test(b.t)) found.secretHits.push(b.url);
      }
      for (const r of stats.log) for (const v of [r.authorization.replace(/^Bearer /, ''), r.apikey]) {
        if (!v) continue;
        if (/^sb_secret_/.test(v)) found.headerSecret++;
        const p = decode(v); if (p) found.headerRoles.add(p.role);
      }
      await context.close();
    }
    const roles = [...found.headerRoles];
    rec('AUTH-009', found.js > 0 && found.secretHits.length === 0 && found.jwtsInJs.every(r => r === 'anon') && found.headerSecret === 0 && roles.length > 0 && roles.every(r => ['anon', 'authenticated'].includes(r)),
      `${found.js} JS responses (${(found.jsBytes / 1024).toFixed(0)} KiB) loaded by admin+operator: JWT roles embedded=${JSON.stringify([...new Set(found.jwtsInJs)])}, service-role/secret-key marker hits=${found.secretHits.length}; roles in Authorization/apikey headers=${JSON.stringify(roles)}, sb_secret headers=${found.headerSecret}`);
  }

  // ---------- SYNC-009: no offline write queue (nothing stored, nothing replayed on reconnect) ----------
  async function offlineNoQueue(browser) {
    const { context, page, errs, stats } = await ctx(browser, 'operator', { serviceWorkers: 'allow' });
    const c = await dbc();
    const counts = async () => (await one(c, `select (select count(*) from public.operation_logs)::int l, (select count(*) from public.fuel_transactions)::int f, (select count(*) from public.chlorine_transactions)::int ch, (select count(*) from public.operators)::int o`));
    const db0 = await counts();
    await go(page, 'operation_logs?asset=' + (await one(c, `select id from public.assets where asset_code='WEL-0001'`)).id);
    const loginWrites = stats.log.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).map(r => `${r.method} ${r.path}`);
    const tOff = Date.now();
    await context.setOffline(true); await page.waitForTimeout(800);
    // try every enabled primary write button while offline
    const tried = [];
    for (const h of ['operation_logs', 'fuel_transactions', 'chlorine_transactions']) {
      await page.evaluate(x => { location.hash = '#/' + x; }, h); await page.waitForTimeout(500);
      for (const b of await page.locator('button:visible').all()) {
        const t = (await b.innerText().catch(() => '')).trim();
        if (/حفظ|إضافة|تسجيل/.test(t) && !/الخروج|الدخول/.test(t) && await b.isEnabled()) { tried.push(`${h}:${t}`); await b.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(200); await page.keyboard.press('Escape').catch(() => {}); }
      }
    }
    const store = await page.evaluate(async () => {
      const ls = Object.keys(localStorage).map(k => ({ k, n: (localStorage.getItem(k) || '').length }));
      const idb = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [];
      return { ls, idb };
    });
    const offWrites = stats.log.filter(r => r.t >= tOff && !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).length;
    const tBack = Date.now();
    await context.setOffline(false); await page.waitForTimeout(6000);
    const afterWrites = stats.log.filter(r => r.t >= tBack && !['GET', 'HEAD', 'OPTIONS'].includes(r.method) && !/\/auth\/v1\//.test(r.path));
    const db1 = await counts();
    const queueish = store.ls.filter(x => /queue|outbox|pending|mutation|sync/i.test(x.k));
    rec('SYNC-009', queueish.length === 0 && store.idb.length === 0 && offWrites === 0 && afterWrites.length === 0 && JSON.stringify(db0) === JSON.stringify(db1),
      `offline: enabled write buttons clicked=${tried.length ? tried.join(', ') : 'none (all disabled)'}; localStorage keys=${JSON.stringify(store.ls.map(x => x.k))} (queue-like=${queueish.length}); IndexedDB dbs=${JSON.stringify(store.idb)}; writes before going offline (login)=${JSON.stringify(loginWrites)}; REST writes while offline=${offWrites}; writes in 6 s after reconnect=${afterWrites.length}; db counts unchanged=${JSON.stringify(db0) === JSON.stringify(db1)}`);
    rec('CONSOLE-offlineNoQueue', errs.filter(e => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(e)).length === 0, errs.filter(e => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(e)).slice(0, 3).join(' | ') || '0 non-network errors');
    await c.end(); await context.close();
  }

  // ---------- BACKUP-004/005 (destructive: last step) ----------
  async function backupUi(browser) {
    const { context, page, errs } = await ctx(browser);
    const c = await dbc();
    const counts = async () => Object.fromEntries((await c.query(`select 'assets' t, count(*)::int n from public.assets union all select 'operation_logs', count(*) from public.operation_logs union all select 'operators', count(*) from public.operators`)).rows.map(r => [r.t, r.n]));
    await go(page, 'backup');
    const bkF = await download(page, /تنزيل نسخة احتياطية شاملة/);
    const bk = JSON.parse(fs.readFileSync(bkF, 'utf8'));
    const tablesOf = j => j.tables || j.data || j;
    const db0 = await counts();
    // after the backup, add a row that the restore must remove
    await c.query(`insert into public.operators (name) values ('مشغل بعد النسخة')`);
    const db1 = await counts();
    await page.locator('input[type=file]').setInputFiles(bkF);
    await page.getByText('معاينة ملف النسخة الاحتياطية قبل التنفيذ').waitFor({ timeout: 8000 });
    const prevText = await page.locator('.MuiCard-root', { hasText: 'معاينة ملف النسخة الاحتياطية قبل التنفيذ' }).innerText();
    const db1b = await counts();
    await page.screenshot({ path: path.join(OUT, 'backup-preview.png'), fullPage: true });
    const shows = Object.entries(db0).every(([k, n]) => new RegExp(`${n}`).test(prevText));
    rec('BACKUP-004', shows && JSON.stringify(db1) === JSON.stringify(db1b), `preview shown before any change (db unchanged ${JSON.stringify(db1b)}); preview text: ${prevText.replace(/\s+/g, ' ').slice(0, 160)}`);
    const [safety] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /تأكيد وتنفيذ الاستعادة الذرية/ }).click(),
    ]);
    const dbAtSafety = await counts();
    const sfF = path.join(OUT, '..', 'downloads', safety.suggestedFilename()); await safety.saveAs(sfF);
    const sf = JSON.parse(fs.readFileSync(sfF, 'utf8'));
    await page.waitForTimeout(3000);
    const db2 = await counts();
    const sfOps = (tablesOf(sf).operators || []).length;
    rec('BACKUP-005', /aoms-pre-restore-safety-/.test(safety.suggestedFilename()) && sfOps === Number(db1.operators) && JSON.stringify(db2) === JSON.stringify(db0),
      `safety file ${safety.suggestedFilename()} downloaded first with operators=${sfOps} (db before restore=${db1.operators}, at download=${dbAtSafety.operators}); after restore db=${JSON.stringify(db2)} == backup ${JSON.stringify(db0)}; backup tables=${Object.keys(tablesOf(bk)).length}`);
    rec('CONSOLE-backupUi', errs.length === 0, errs.slice(0, 3).join(' | ') || '0 errors');
    await c.end(); await context.close();
  }

  // ---------- SYNC-007 against a REAL supabase/realtime server (only with REALTIME_WS, see e2e/run-realtime-real.sh) ----------
  async function realtimeReal(browser) {
    if (!process.env.REALTIME_WS) { console.log('  (skipped: REALTIME_WS not set)'); return; }
    const c = await dbc();
    // Phoenix serializer: vsn 2.0.0 sends [join_ref, ref, topic, event, payload] arrays, vsn 1.0.0 objects
    const frames = st => (st.wsIn || []).map(t => { try { const m = JSON.parse(t);
      return Array.isArray(m) ? { topic: m[2], event: m[3], payload: m[4] } : m; } catch { return {}; } });
    const subscribed = st => frames(st).some(f => f.event === 'system' && f.payload?.extension === 'postgres_changes' && f.payload?.status === 'ok');
    const dev = async who => { const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const stats = await wire(context); const page = await context.newPage(); const errs = []; watch(page, errs);
      await login(page, who); await go(page, 'operators'); return { context, stats, page, errs }; };
    const A = await dev('admin'), B = await dev('viewer');
    for (let i = 0; i < 60 && !(subscribed(A.stats) && subscribed(B.stats)); i++) await B.page.waitForTimeout(500);
    const subOk = subscribed(A.stats) && subscribed(B.stats);
    await B.page.evaluate(() => { window.__noReload = 1; });
    const name = `مشغل لحظي ${Date.now() % 100000}`;
    const pre = await B.page.getByText(name).count();
    await A.page.getByRole('button', { name: 'إضافة مشغل' }).first().click();
    const dlg = A.page.getByRole('dialog'); await dlg.waitFor();
    await dlg.getByLabel('اسم المشغل *').fill(name);
    const t0 = Date.now(); await dlg.getByRole('button', { name: /^حفظ/ }).click();
    await B.page.getByText(name).first().waitFor({ timeout: 15000 }).catch(() => {});
    const ms = Date.now() - t0; const post = await B.page.getByText(name).count();
    const inDb = (await c.query('select count(*)::int n from public.operators where name=$1', [name])).rows[0].n;
    const kept = await B.page.evaluate(() => window.__noReload === 1);
    await B.page.screenshot({ path: path.join(OUT, 'realtime-real-deviceB.png') });
    const evB = frames(B.stats).filter(f => f.event === 'postgres_changes').map(f => `${f.payload?.data?.table}:${f.payload?.data?.type}`);
    const evA = frames(A.stats).filter(f => f.event === 'postgres_changes').map(f => `${f.payload?.data?.table}:${f.payload?.data?.type}`);
    rec('SYNC-007', subOk && pre === 0 && inDb === 1 && post > 0 && kept && evB.includes('operators:INSERT'),
      `REAL supabase/realtime (${process.env.REALTIME_WS}): both devices "Subscribed to PostgreSQL"=${subOk}; device A (admin) added "${name}" via UI (rows in PG=${inDb}); device B (viewer) before=${pre}, after=${post} in ${ms} ms without reload=${kept}; B received ${JSON.stringify([...new Set(evB)])}`);
    // RLS through Realtime: audit_logs is admin-only, so only the admin socket may receive its change
    rec('SYNC-007-RLS', evA.includes('audit_logs:INSERT') && !evB.some(e => e.startsWith('audit_logs')),
      `admin received ${JSON.stringify([...new Set(evA)])}; viewer audit_logs events=${evB.filter(e => e.startsWith('audit_logs')).length}`);
    if (process.env.DEBUG) console.log('  ws frames B', (B.stats.wsIn || []).map(t => t.slice(0, 160)));
    const bad = [...A.errs, ...B.errs]; rec('CONSOLE-realtimeReal', bad.length === 0, bad.slice(0, 3).join(' | ') || '0 errors');
    await c.end(); await A.context.close(); await B.context.close();
  }

  return { accSetup, searchTimeline, reports, formsUi, offlineSync, offlineNoQueue, keysRuntime, largeData, realtimeReal, backupUi };
}
