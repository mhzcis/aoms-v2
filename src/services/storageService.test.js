import { afterEach, describe, expect, it } from 'vitest';
import { CORRUPT_KEY_PREFIX, loadState, saveData, STORAGE_KEY } from './storageService';
import { gen, memoryStorage } from '../test/fixtures';

afterEach(() => {
  delete globalThis.localStorage;
});

describe('التخزين المحلي: البيانات التالفة وفشل الحفظ', () => {
  it('بيانات JSON تالفة: لا يُكتب فوقها، وتُحفظ القيمة الخام تحت مفتاح منفصل مرة واحدة', () => {
    globalThis.localStorage = memoryStorage();
    localStorage.setItem(STORAGE_KEY, '{not json');
    const s = loadState();
    expect(s.data).toEqual({ version: '1.0', generators: [], logs: [], meta: { lastBackupAt: null } });
    expect(s.corrupt.raw).toBe('{not json');
    expect(s.corrupt.key.startsWith(CORRUPT_KEY_PREFIX)).toBe(true);
    expect(localStorage.getItem(s.corrupt.key)).toBe('{not json');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{not json');
    const again = loadState();
    expect(again.corrupt.key).toBe(s.corrupt.key);
    expect(Object.keys(localStorage.store).filter(k => k.startsWith(CORRUPT_KEY_PREFIX))).toHaveLength(1);
  });

  it('صيغة غير معروفة (JSON صالح بلا مولدات/سجلات) تُعامل كبيانات تالفة', () => {
    globalThis.localStorage = memoryStorage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 1 }));
    expect(loadState().corrupt?.raw).toBe('{"foo":1}');
  });

  it('لا توجد بيانات: بداية جديدة بلا تنبيه تلف، والبيانات الصالحة تُقرأ', () => {
    globalThis.localStorage = memoryStorage();
    expect(loadState().corrupt).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: '1.0', generators: [gen('a')], logs: [], meta: {} }));
    const s = loadState();
    expect(s.corrupt).toBeNull();
    expect(s.data.generators).toHaveLength(1);
  });

  it('إذا تعذر حفظ النسخة التالفة يبقى التنبيه مع القيمة الخام بلا مفتاح', () => {
    const m = memoryStorage();
    m.store[STORAGE_KEY] = 'xx';
    m.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    globalThis.localStorage = m;
    expect(loadState().corrupt).toEqual({ raw: 'xx', key: null });
  });

  it('saveData يعيد false عند امتلاء التخزين بدل رمي خطأ', () => {
    const m = memoryStorage();
    m.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    globalThis.localStorage = m;
    expect(saveData({ generators: [], logs: [] })).toBe(false);
    globalThis.localStorage = memoryStorage();
    expect(saveData({ generators: [], logs: [] })).toBe(true);
  });
});
