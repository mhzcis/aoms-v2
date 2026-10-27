// خط Tajawal مستضاف ذاتيًا ضمن حزمة التطبيق (يعمل دون اتصال، بلا CDN).
import ar400 from '@fontsource/tajawal/files/tajawal-arabic-400-normal.woff2?url';
import ar500 from '@fontsource/tajawal/files/tajawal-arabic-500-normal.woff2?url';
import ar700 from '@fontsource/tajawal/files/tajawal-arabic-700-normal.woff2?url';
import ar800 from '@fontsource/tajawal/files/tajawal-arabic-800-normal.woff2?url';
import la400 from '@fontsource/tajawal/files/tajawal-latin-400-normal.woff2?url';
import la500 from '@fontsource/tajawal/files/tajawal-latin-500-normal.woff2?url';
import la700 from '@fontsource/tajawal/files/tajawal-latin-700-normal.woff2?url';
import la800 from '@fontsource/tajawal/files/tajawal-latin-800-normal.woff2?url';

const ARABIC_RANGE = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const FILES = [
  [400, ar400, ARABIC_RANGE], [500, ar500, ARABIC_RANGE], [700, ar700, ARABIC_RANGE], [800, ar800, ARABIC_RANGE],
  [400, la400, LATIN_RANGE], [500, la500, LATIN_RANGE], [700, la700, LATIN_RANGE], [800, la800, LATIN_RANGE],
];

const absolute = url => {
  try {
    return typeof document !== 'undefined' ? new URL(url, document.baseURI).href : url;
  } catch {
    return url;
  }
};

// قواعد @font-face بروابط مطلقة لاستخدامها في نافذة الطباعة/PDF.
export const tajawalFontFaceCss = () =>
  FILES.map(
    ([weight, url, range]) =>
      `@font-face{font-family:'Tajawal';font-style:normal;font-display:swap;font-weight:${weight};src:url(${absolute(url)}) format('woff2');unicode-range:${range};}`
  ).join('\n');

// تحميل ملفات الخط عبر الصفحة الرئيسية (التي يخدمها Service Worker فتعمل دون اتصال) وإضافتها إلى
// مستند نافذة الطباعة، لأن نافذة الطباعة لا يتحكم بها Service Worker.
export const attachTajawalFonts = async win => {
  if (!win?.FontFace || !win.document?.fonts || typeof fetch !== 'function') return false;
  const faces = await Promise.all(
    FILES.map(async ([weight, url, range]) => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const face = new win.FontFace('Tajawal', buf, { weight: String(weight), style: 'normal', unicodeRange: range });
        await face.load();
        win.document.fonts.add(face);
        return true;
      } catch {
        return false;
      }
    })
  );
  return faces.some(Boolean);
};
