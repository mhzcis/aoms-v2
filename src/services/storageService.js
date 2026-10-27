import { EMPTY_DATA } from '../data/defaultData';
import { normalizeDefaultGenerator } from '../utils/generators';

const KEY = 'generator-tracker-v1';

export const STORAGE_KEY = KEY;
export const CORRUPT_KEY_PREFIX = `${KEY}-corrupt-`;

const isValidShape = x => !!x && typeof x === 'object' && Array.isArray(x.generators) && Array.isArray(x.logs);

const normalize = x => {
  const validGenerators = x.generators.filter(g => g && typeof g === 'object' && typeof g.id === 'string');
  const validLogs = x.logs.filter(l => l && typeof l === 'object' && typeof l.id === 'string' && typeof l.date === 'string');
  return {
    ...EMPTY_DATA,
    ...x,
    generators: normalizeDefaultGenerator(validGenerators),
    logs: validLogs,
  };
};

const pad = n => String(n).padStart(2, '0');
const keyStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

// يحفظ القيمة التالفة كما هي تحت مفتاح منفصل (مرة واحدة لكل قيمة)، ويعيد اسم المفتاح أو null إذا تعذر الحفظ.
export const preserveCorruptData = raw => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CORRUPT_KEY_PREFIX) && localStorage.getItem(k) === raw) return k;
    }
    const k = CORRUPT_KEY_PREFIX + keyStamp();
    localStorage.setItem(k, raw);
    return k;
  } catch {
    return null;
  }
};

// يقرأ البيانات المحفوظة. عند تلفها لا يُكتب فوقها: تُعاد بيانات فارغة مع وصف التلف (القيمة الخام ومفتاح النسخة المحفوظة).
export const loadState = () => {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { data: structuredClone(EMPTY_DATA), corrupt: null };
  }
  if (raw === null || raw === undefined || raw === '') {
    return { data: structuredClone(EMPTY_DATA), corrupt: null };
  }
  try {
    const x = JSON.parse(raw);
    if (isValidShape(x)) return { data: normalize(x), corrupt: null };
  } catch {}
  return { data: structuredClone(EMPTY_DATA), corrupt: { raw, key: preserveCorruptData(raw) } };
};

export const loadData = () => loadState().data;

export const saveData = data => {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
};

export const clearData = () => {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
};
