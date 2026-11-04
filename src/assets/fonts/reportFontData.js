// Noto Naskh Arabic, SIL OFL 1.1 (Noto-OFL.txt). Local font assets are shared
// by the report preview, print and PDF; no external font service is needed.
import regularUrl from './NotoNaskhArabic-Regular.ttf?url';
import boldUrl from './NotoNaskhArabic-Bold.ttf?url';
export const REPORT_FONT = 'Noto Naskh Arabic';
export const REPORT_FONT_STACK = '"Noto Naskh Arabic", "Traditional Arabic", Tahoma, Arial, serif';
const FONT_FILES = { regular: regularUrl, bold: boldUrl };
let cache = null;

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

export async function loadReportFonts(fetchImpl = globalThis.fetch) {
  if (cache) return cache;
  const entries = await Promise.all(
    Object.entries(FONT_FILES).map(async ([key, file]) => {
      const res = await fetchImpl(file);
      if (!res.ok) throw new Error(`تعذر تحميل خط PDF (${file}): ${res.status}`);
      return [key, arrayBufferToBase64(await res.arrayBuffer())];
    })
  );
  cache = Object.fromEntries(entries);
  return cache;
}

export const reportFontFaceCss = () => Object.entries(FONT_FILES).map(([style, url]) => {
  const absolute = typeof document !== 'undefined' ? new URL(url, document.baseURI).href : url;
  return `@font-face{font-family:'${REPORT_FONT}';font-style:normal;font-display:swap;font-weight:${style === 'bold' ? 700 : 400};src:url(${absolute}) format('truetype');}`;
}).join('\n');

export async function attachReportFonts(win) {
  if (!win?.FontFace || !win.document?.fonts) return false;
  const loaded = await Promise.all(Object.entries(FONT_FILES).map(async ([style, url]) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const face = new win.FontFace(REPORT_FONT, await res.arrayBuffer(), {weight: style === 'bold' ? '700' : '400'});
      await face.load(); win.document.fonts.add(face); return true;
    } catch { return false; }
  }));
  return loaded.every(Boolean);
}
