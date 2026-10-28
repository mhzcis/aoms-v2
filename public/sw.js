/* Service Worker بسيط وآمن لنظام متابعة تشغيل المولدات.
   - index.html (التنقل): الشبكة أولًا ثم النسخة المخزنة عند انقطاع الاتصال.
   - الأصول المبنية (assets/ ذات الأسماء المجزأة) والأيقونات: من الذاكرة المؤقتة أولًا.
   - النطاق: مجلد هذا الملف (./) فيعمل تحت /generator-operation-tracker/. */
const VERSION = 'v2.0.0';
const CACHE = `aoms-v2-fp1-${VERSION}`;
const SCOPE = new URL('./', self.location).href;
const INDEX = new URL('./index.html', SCOPE).href;
const STATIC = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'].map(
  p => new URL(p, SCOPE).href
);

// يستخرج روابط الأصول من الصفحة ومن ملفات CSS (مثل ملفات الخط) لتخزينها مسبقًا.
const assetUrls = async () => {
  const urls = new Set();
  try {
    const html = await (await fetch(INDEX, { cache: 'no-store' })).text();
    for (const m of html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)) urls.add(new URL(m[1], SCOPE).href);
    // الأجزاء المحمّلة عند الطلب (مثل مكتبة Excel) تُذكر داخل ملف JS الرئيسي بمسار نسبي.
    for (const u of [...urls].filter(x => x.endsWith('.js'))) {
      const js = await (await fetch(u)).text();
      for (const m of js.matchAll(/["'`]\.\/([\w.-]+\.(?:js|css|woff2))["'`]/g)) if (m[1] !== 'sw.js') urls.add(new URL(m[1], u).href);
    }
    for (const u of [...urls].filter(x => x.endsWith('.css'))) {
      const css = await (await fetch(u)).text();
      for (const m of css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)) urls.add(new URL(m[1], u).href);
    }
  } catch {}
  return [...urls];
};

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(STATIC.map(u => cache.add(u).catch(() => {})));
      await Promise.all((await assetUrls()).map(u => cache.add(u).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('aoms-v2-') && k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  const url = new URL(req.url);
  const isPage = req.mode === 'navigate' || url.href === SCOPE || url.href === INDEX;

  if (isPage) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req, { cache: 'no-store' });
          if (res.ok) {
            cache.put(INDEX, res.clone());
            // تخزين أصول النسخة الجديدة في الخلفية.
            event.waitUntil(assetUrls().then(list => Promise.all(list.map(u => cache.match(u).then(hit => hit || cache.add(u).catch(() => {}))))));
          }
          return res;
        } catch {
          return (await cache.match(INDEX)) || (await cache.match(SCOPE)) || Response.error();
        }
      })()
    );
    return;
  }

  if (url.pathname.includes('/assets/') || STATIC.includes(url.href)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      })()
    );
  }
});
