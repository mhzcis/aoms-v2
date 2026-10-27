// Amiri (SIL Open Font License 1.1, see public/fonts/OFL.txt) is shipped as
// static files in public/fonts and loaded lazily only when a PDF is exported,
// so the ~850 KB of font data is not part of the main JS bundle.
const FONT_FILES = { amiriRegular: 'Amiri-Regular.ttf', amiriBold: 'Amiri-Bold.ttf' };
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

export async function loadAmiriFonts(fetchImpl = globalThis.fetch, baseUrl = (import.meta.env?.BASE_URL ?? '/')) {
  if (cache) return cache;
  const entries = await Promise.all(
    Object.entries(FONT_FILES).map(async ([key, file]) => {
      const res = await fetchImpl(`${baseUrl}fonts/${file}`);
      if (!res.ok) throw new Error(`تعذر تحميل خط PDF (${file}): ${res.status}`);
      return [key, arrayBufferToBase64(await res.arrayBuffer())];
    })
  );
  cache = Object.fromEntries(entries);
  return cache;
}
