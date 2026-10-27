// AOMS V2 browser E2E (Playwright Chromium) against `vite preview` of a production build.
// Backend: REAL PostgREST + PostgreSQL (seeded by e2e/seed.mjs). Supabase Auth (GoTrue) and Realtime
// are NOT available locally, so /auth/v1 is stubbed (HS256 JWTs signed with the PostgREST secret) and
// the realtime websocket is answered with Phoenix "ok" replies; `stats.push()` lets a test send a
// postgres_changes frame on that socket (client-side handling only, not real Supabase Realtime).
// REALTIME_WS=ws://127.0.0.1:4000 (with ONLY=realtimeReal) instead bridges the socket to a REAL supabase/realtime
// server (tenant "aomslocal", same JWT secret, reading this PostgreSQL's WAL via wal2json); see e2e/run-realtime-real.sh.
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createRequire } from 'node:module';
import { USERS } from './seed.mjs';
import { makeSteps } from './acceptance-steps.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:4173/';
const PGRST = process.env.PGRST_URL || 'http://127.0.0.1:54330';
const SECRET = process.env.JWT_SECRET || 'aoms-e2e-local-only-secret-0123456789abcdef';
const PGURL = process.env.PGURL || 'postgres://postgres@127.0.0.1:54329/aoms_e2e';
const OUT = process.env.SHOTS || path.resolve('e2e-screens');
const PASSWORD = 'Aoms#E2E-2026';
const REALTIME_WS = process.env.REALTIME_WS || '';
fs.mkdirSync(OUT, { recursive: true });

const SCREENS = ['', 'categories', 'assets', 'operators', 'operation_logs', 'fuel_transactions', 'chlorine_transactions',
  'reports', 'search', 'timeline_events', 'settings', 'users', 'backup'];
const results = [];
const rec = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = claims => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims);
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const userObj = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: { full_name: u.name }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
const session = u => { const now = Math.floor(Date.now() / 1000);
  return { access_token: jwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: now, exp: now + 3600 }),
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt-' + u.id, user: userObj(u) }; };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

async function wire(context) {
  const channels = [];
  const stats = { rest: 0, auth: 0, ws: 0, log: [],
    push: data => { let n = 0; for (const ch of channels) if (/aoms-db/.test(ch.topic)) {
      ch.ws.send(JSON.stringify([ch.joinRef, null, ch.topic, 'postgres_changes', { ids: ch.ids, data }])); n++; } return n; } };
  context.setDefaultTimeout(15000);
  await context.route(/^https:\/\/aomslocal\.supabase\.co\/.*/, route => handle(route).catch(e => {
    if (!/collected|closed|Target page/.test(e.message)) console.error('route handler error', e.message); }));
  async function handle(route) {
    const req = route.request(); const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (process.env.DEBUG) console.log('route', req.method(), url.pathname + url.search.slice(0, 60));
    // request log for AUTH-009 (which keys the browser sends), SYNC-009 (no queued writes) and REG-006 (paged reads)
    stats.log.push({ t: Date.now(), method: req.method(), path: url.pathname, search: url.search, authorization: req.headers().authorization || '', apikey: req.headers().apikey || '' });
    if (url.pathname.startsWith('/rest/v1/')) {
      stats.rest++;
      // forwarded from Node (not route.fetch) so the browser's proxy settings cannot interfere
      const headers = { ...req.headers() }; delete headers.host;
      const res = await fetch(PGRST + url.pathname.slice('/rest/v1'.length) + url.search,
        { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() });
      const out = {}; res.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) out[k] = v; });
      return route.fulfill({ status: res.status, headers: { ...out, ...CORS }, body: Buffer.from(await res.arrayBuffer()) });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      stats.auth++;
      const json = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (url.pathname === '/auth/v1/token') {
        const body = JSON.parse(req.postData() || '{}');
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const u = Object.values(USERS).find(x => 'rt-' + x.id === body.refresh_token);
          return u ? json(200, session(u)) : json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        }
        const u = Object.values(USERS).find(x => x.email === body.email);
        return u && body.password === PASSWORD ? json(200, session(u)) : json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      if (url.pathname === '/auth/v1/user') {
        const tok = (req.headers().authorization || '').replace('Bearer ', '');
        const sub = JSON.parse(Buffer.from(tok.split('.')[1] || 'e30', 'base64url').toString()).sub;
        const u = Object.values(USERS).find(x => x.id === sub);
        return u ? json(200, userObj(u)) : json(401, { msg: 'invalid' });
      }
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
      return json(404, { msg: 'not stubbed' });
    }
    return route.fulfill({ status: 404, headers: CORS, body: 'not stubbed' });
  }
  if (REALTIME_WS) {
    // bridge page <-> real Realtime server (Playwright's bundled `ws` client; Host header selects the tenant)
    const { ws: WS } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
    await context.routeWebSocket(/aomslocal\.supabase\.co\/realtime/, ws => {
      stats.ws++;
      const server = new WS(REALTIME_WS + '/socket/websocket' + new URL(ws.url()).search, { headers: { host: 'aomslocal.localhost' } });
      const pending = [];
      server.on('open', () => { stats.wsOpen = (stats.wsOpen || 0) + 1; for (const m of pending.splice(0)) server.send(m); });
      server.on('message', m => { const t = String(m); stats.wsIn = [...(stats.wsIn || []), t]; ws.send(t); });
      server.on('close', () => ws.close().catch(() => {})); server.on('error', e => { stats.wsErr = e.message; });
      ws.onMessage(m => { const t = String(m); if (server.readyState === 1) server.send(t); else pending.push(t); });
      ws.onClose(() => server.close());
    });
    return stats;
  }
  await context.routeWebSocket(/aomslocal\.supabase\.co\/realtime/, ws => {
    stats.ws++;
    ws.onMessage(raw => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      const arr = Array.isArray(m);
      const [joinRef, ref, topic, event, payload] = arr ? m : [m.join_ref, m.ref, m.topic, m.event, m.payload];
      let response = {};
      if (event === 'phx_join') {
        response = { postgres_changes: (payload?.config?.postgres_changes || []).map((c, i) => ({ ...c, id: i + 1 })) };
        channels.push({ ws, joinRef, topic, ids: response.postgres_changes.map(c => c.id) });
      }
      else if (!['heartbeat', 'access_token', 'phx_leave'].includes(event)) return;
      const reply = { status: 'ok', response };
      ws.send(JSON.stringify(arr ? [joinRef, ref, topic, 'phx_reply', reply] : { join_ref: joinRef, ref, topic, event: 'phx_reply', payload: reply }));
    });
  });
  return stats;
}

function watch(page, bucket) {
  page.on('console', m => { if (m.type() === 'error') bucket.push(`console: ${m.text()}`); });
  page.on('pageerror', e => bucket.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => { if (!/realtime/.test(r.url())) bucket.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
}

async function login(page, who) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByLabel('البريد الإلكتروني').fill(USERS[who].email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.getByText('نظام إدارة وتشغيل الأصول والمعدات').first().waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

async function probe(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const ff = getComputedStyle(document.body).fontFamily;
    const h = document.querySelector('h1,h2,h3,h4,h5,h6,.MuiTypography-root');
    return { dir: document.documentElement.dir || document.body.dir, lang: document.documentElement.lang,
      fontFamily: h ? getComputedStyle(h).fontFamily : ff, tajawalLoaded: document.fonts.check('16px Tajawal', 'عربي'),
      bg: getComputedStyle(document.body).backgroundColor, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      text: document.body.innerText.slice(0, 120) };
  });
}

async function matrix(browser) {
  const configs = [
    { name: 'desktop', opts: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ];
  for (const cfg of configs) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ ...cfg.opts, locale: 'ar', serviceWorkers: 'allow' });
    const stats = await wire(context);
    const page = await context.newPage(); const errs = []; watch(page, errs);
    await login(page, 'admin');
    if (theme === 'dark') { await page.getByLabel('تغيير المظهر').click(); await page.waitForTimeout(300); }
    const tag = `${cfg.name}-${theme}`;
    for (const s of SCREENS) {
      await page.goto(APP + '#/' + s, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
      const p = await probe(page);
      await page.screenshot({ path: path.join(OUT, `${tag}-${s || 'dashboard'}.png`), fullPage: cfg.name === 'desktop' });
      const isDark = (() => { const m = p.bg.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3 < 100; })();
      const ok = p.dir === 'rtl' && /Tajawal/.test(p.fontFamily) && p.tajawalLoaded && (theme === 'dark') === isDark && (cfg.name !== 'mobile' || p.overflowX <= 1)
        && !/خطأ غير متوقع|Something went wrong/.test(p.text);
      rec(`UI-${tag}-${s || 'dashboard'}`, ok, `dir=${p.dir} font=${p.fontFamily.split(',')[0]} tajawal=${p.tajawalLoaded} bg=${p.bg} overflowX=${p.overflowX}`);
    }
    rec(`CONSOLE-${tag}`, errs.length === 0, errs.length ? errs.slice(0, 5).join(' | ') : `0 console/page errors over ${SCREENS.length} screens (rest=${stats.rest} auth=${stats.auth} ws=${stats.ws})`);
    await context.close();
  }
}

async function pwa(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
  await wire(context);
  const page = await context.newPage(); const errs = []; watch(page, errs);
  await page.goto(APP, { waitUntil: 'networkidle' });
  const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return { status: r.status, json: await r.json() }; });
  rec('PWA-MANIFEST', man.status === 200 && man.json.dir === 'rtl' && man.json.lang === 'ar' && man.json.icons.length >= 3 && man.json.display === 'standalone',
    `status=${man.status} dir=${man.json.dir} lang=${man.json.lang} icons=${man.json.icons.length} display=${man.json.display}`);
  const icons = await Promise.all(man.json.icons.map(i => page.evaluate(async s => (await fetch(s)).status, new URL(i.src, APP).href)));
  rec('PWA-ICONS', icons.every(s => s === 200), JSON.stringify(icons));
  const sw = await page.evaluate(async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise(res => setTimeout(() => res(null), 8000))]);
    return r ? { scope: r.scope, state: r.active?.state, script: r.active?.scriptURL } : null; });
  rec('PWA-SW', !!sw && sw.state === 'activated', JSON.stringify(sw));
  await context.close();
}

async function offline(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
  await wire(context);
  const page = await context.newPage(); const errs = []; watch(page, errs);
  await login(page, 'operator');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' }); // make sure the SW controls the page and has cached the shell
  await page.goto(APP + '#/operators', { waitUntil: 'networkidle' });
  const rowsOnline = await page.locator('tbody tr').count();
  await context.setOffline(true);
  await page.waitForTimeout(800);
  const banner = await page.getByText('غير متصل — وضع القراءة فقط').count();
  const chip = await page.getByText('قراءة فقط', { exact: true }).count();
  await page.goto(APP + '#/operation_logs'); await page.waitForTimeout(800);
  const disabledSave = await page.locator('button:has-text("حفظ")').evaluateAll(bs => bs.map(b => b.disabled));
  await page.screenshot({ path: path.join(OUT, 'offline-operation_logs.png') });
  rec('OFFLINE-READONLY', banner > 0 && chip > 0 && disabledSave.every(Boolean),
    `banner=${banner} chip=${chip} saveButtons=${JSON.stringify(disabledSave)} rowsBefore=${rowsOnline}`);
  // reload while offline: shell must come from the service-worker cache
  let reloadOk = false, reloadText = '';
  try { await page.reload({ timeout: 10000 }); await page.waitForTimeout(1500); reloadText = (await page.evaluate(() => document.body.innerText)).slice(0, 80); reloadOk = reloadText.length > 0; } catch (e) { reloadText = e.message.slice(0, 80); }
  await page.screenshot({ path: path.join(OUT, 'offline-reload.png') });
  rec('OFFLINE-RELOAD-SHELL', reloadOk, `after offline reload: "${reloadText.replace(/\n/g, ' ')}"`);
  await context.setOffline(false);
  await context.close();
}

async function permissions(browser) {
  for (const who of ['operator', 'viewer']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await wire(context);
    const page = await context.newPage(); const errs = []; watch(page, errs);
    await login(page, who);
    await page.goto(APP + '#/operators', { waitUntil: 'networkidle' });
    const add = await page.locator('button:has-text("إضافة مشغل")').evaluateAll(bs => bs.map(b => b.disabled));
    await page.goto(APP + '#/users', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
    const usersTxt = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: path.join(OUT, `perm-${who}-users.png`) });
    rec(`PERM-${who}`, add.every(Boolean) && !/admin@aoms\.test/.test(usersTxt), `addOperatorButtons=${JSON.stringify(add)} usersScreenShowsAdminEmail=${/admin@aoms\.test/.test(usersTxt)}`);
    await context.close();
  }
}

async function conflict(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await wire(context);
  const page = await context.newPage(); const errs = []; watch(page, errs);
  await login(page, 'admin');
  await page.goto(APP + '#/operators', { waitUntil: 'networkidle' });
  const row = page.locator('tbody tr', { hasText: 'سامي خليل' });
  await row.locator('button').last().click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  // a second writer (another device) changes the same row in the real database meanwhile
  const db = new pg.Client({ connectionString: PGURL }); await db.connect();
  const before = (await db.query(`select version from public.operators where name='سامي خليل'`)).rows[0].version;
  await db.query(`update public.operators set notes='تعديل من جهاز آخر' where name='سامي خليل'`);
  const after = (await db.query(`select version from public.operators where name='سامي خليل'`)).rows[0].version;
  await dlg.getByLabel('ملاحظات').fill('تعديل قديم');
  await dlg.getByRole('button', { name: 'حفظ' }).click();
  await page.waitForTimeout(1500);
  const txt = await page.evaluate(() => document.body.innerText);
  const conflictAlerts = await page.locator('.MuiAlert-root', { hasText: 'تعارض' }).evaluateAll(as => as.filter(a => a.offsetParent !== null || getComputedStyle(a).position === 'fixed').length);
  rec('UI-SINGLE-CONFLICT-NOTICE', conflictAlerts === 1, `visible alerts containing the conflict text: ${conflictAlerts}`);
  const notes = (await db.query(`select notes, version from public.operators where name='سامي خليل'`)).rows[0];
  await page.screenshot({ path: path.join(OUT, 'version-conflict.png') });
  await db.end();
  const shown = /تعارض/.test(txt);
  rec('SYNC-CONFLICT-UI', shown && notes.notes === 'تعديل من جهاز آخر',
    `db version ${before}->${after}; stale save shown conflict=${shown}; db notes="${notes.notes}" v${notes.version}`);
  rec('CONSOLE-conflict', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '0 errors');
  // a fresh save after reload must succeed
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('tbody tr', { hasText: 'سامي خليل' }).locator('button').last().click();
  await page.getByRole('dialog').getByLabel('ملاحظات').fill('تعديل بعد التحديث');
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await page.waitForTimeout(1500);
  const db2 = new pg.Client({ connectionString: PGURL }); await db2.connect();
  const n2 = (await db2.query(`select notes from public.operators where name='سامي خليل'`)).rows[0].notes; await db2.end();
  rec('SYNC-SAVE-AFTER-RELOAD', n2 === 'تعديل بعد التحديث', `db notes="${n2}"`);
  await context.close();
}

async function badLogin(browser) {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByLabel('البريد الإلكتروني').fill('admin@aoms.test');
  await page.locator('input[type=password]').fill('wrong');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.waitForTimeout(1200);
  const t = await page.evaluate(() => document.body.innerText);
  rec('AUTH-BAD-LOGIN', /تسجيل الدخول/.test(t) && !/تسجيل الخروج/.test(t), 'stays on login screen');
  await page.screenshot({ path: path.join(OUT, 'login-error.png') });
  await context.close();
}

async function writeFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await wire(context);
  const page = await context.newPage(); const errs = []; watch(page, errs);
  await login(page, 'operator');
  await page.goto(APP + '#/operation_logs', { waitUntil: 'networkidle' });
  const db = new pg.Client({ connectionString: PGURL }); await db.connect();
  const q = `select l.current_reading, l.fuel_consumed, l.created_by, l.operation_date::text d from public.operation_logs l
    join public.assets a on a.id=l.asset_id where a.asset_code='GEN-0001' order by l.operation_date desc limit 1`;
  const prev = (await db.query(q)).rows[0];
  await page.getByLabel(/القراءة الحالية/).fill(String(Number(prev.current_reading) + 8));
  await page.getByLabel(/حرارة الزيت/).fill('85');
  await page.getByRole('button', { name: 'حفظ سجل التشغيل' }).click();
  await page.waitForTimeout(2000);
  const now = (await db.query(q)).rows[0];
  const v = (await db.query(`select v.value_number from public.operation_log_values v join public.category_fields f on f.id=v.field_id
    join public.operation_logs l on l.id=v.operation_log_id where f.field_key='oil_temp' order by l.operation_date desc limit 1`)).rows[0];
  await page.screenshot({ path: path.join(OUT, 'operator-saved-log.png') });
  await db.end();
  rec('UI-WRITE-OPLOG', Number(now.current_reading) === Number(prev.current_reading) + 8 && Number(now.fuel_consumed) === 36 && now.created_by === USERS.operator.id && Number(v?.value_number) === 85,
    `db: ${prev.d} ${prev.current_reading} -> ${now.d} ${now.current_reading}, fuel_consumed=${now.fuel_consumed}, created_by=operator:${now.created_by === USERS.operator.id}, oil_temp=${v?.value_number}`);
  await page.getByRole('button', { name: 'حفظ سجل التشغيل' }).count();
  const txt = await page.evaluate(() => document.body.innerText);
  rec('UI-ONE-LOG-PER-DAY', /لا يمكن إضافة سجل جديد حتى اليوم التالي|تعديل آخر سجل تشغيل/.test(txt), 'form switches to edit-latest / same-day block after saving today');
  rec('CONSOLE-writeFlow', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '0 errors');
  await context.close();
}

const browser = await chromium.launch();
const acc = makeSteps({ APP, OUT, PGURL, USERS, rec, wire, watch, login });
// order matters: accSetup adds data the later steps use; backupUi restores and must stay last
const steps = { badLogin, matrix, pwa, offline, permissions, conflict, writeFlow, ...acc };
// REG-006 large data runs before backupUi so the backup/restore also carries > 1000 rows per table
const only = (process.env.ONLY || '').split(',').filter(Boolean);
for (const [n, fn] of Object.entries(steps)) {
  if (only.length && !only.includes(n)) continue;
  console.log(`# step ${n}`);
  try { await fn(browser); } catch (e) { rec(`STEP-${n}`, false, 'threw: ' + e.message.split('\n').slice(0, 3).join(' ')); }
}
await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(`\n# E2E: ${pass}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, '..', process.env.RESULTS || 'e2e-results.json'), JSON.stringify(results, null, 2));
process.exit(pass === results.length ? 0 : 1);
