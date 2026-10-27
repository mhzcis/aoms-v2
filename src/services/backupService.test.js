import { describe, expect, it, vi } from 'vitest';
import {
  isWipeConfirmed,
  MAX_BACKUP_BYTES,
  parseBackup,
  restoreBackup,
  validateBackup,
  wipeAllData,
} from './backupService';
import { gen, log, TODAY } from '../test/fixtures';

const file = (content, size) => ({
  size,
  text: async () => (typeof content === 'string' ? content : JSON.stringify(content)),
});
const backup = (generators, logs, extra = {}) => ({
  version: '1.0',
  generators,
  logs,
  meta: {},
  ...extra,
});
const valid = () =>
  backup(
    [gen('a'), gen('b')],
    [
      log('1', 'a', '2026-10-01', {
        previousReading: 0,
        currentReading: 10,
        operatingHours: 10,
        day: 'خطأ',
      }),
      log('2', 'a', '2026-10-02', {
        recordType: 'meterReset',
        previousReading: 10,
        currentReading: 3,
        operatingHours: 99,
      }),
      log('3', 'b', '2026-10-02', {
        previousReading: 5,
        currentReading: 9,
        operatingHours: 1,
      }),
    ]
  );
const reject = (x, part) => expect(() => validateBackup(x, TODAY)).toThrow(part);

describe('النسخ الاحتياطي والاستعادة', () => {
  it('يرفض ملفًا تالفًا أو يتجاوز الحجم المسموح به', async () => {
    await expect(parseBackup(file('{not json'))).rejects.toThrow('الملف تالف');
    await expect(parseBackup(file(valid(), MAX_BACKUP_BYTES + 1))).rejects.toThrow('حجم الملف');
    reject(null, 'بنية الملف');
    reject([], 'بنية الملف');
  });

  it('يرفض إصدارًا غير مدعوم أو بنية ناقصة', () => {
    reject({ ...valid(), version: '2.0' }, 'غير مدعوم');
    reject({ version: '1.0', generators: {}, logs: [] }, 'مفقودتان');
  });

  it('يرفض أرقام مولدات مكررة مع تجاهل حالة الأحرف والمسافات', () => {
    reject(backup([gen('a', { number: 'G-1' }), gen('b', { number: ' g-1 ' })], []), 'مكرر');
  });

  it('يرفض مولدًا بلا اسم أو موقع أو بإحداثيات غير صالحة', () => {
    reject(backup([gen('a', { name: '  ' })], []), 'اسم صالح');
    reject(backup([gen('a', { location: '' })], []), 'موقع صالح');
    reject(backup([gen('a', { latitude: '95' })], []), 'إحداثيات العرض');
    reject(backup([gen('a', { longitude: '-190' })], []), 'إحداثيات الطول');
  });

  it('يرفض سجلًا يتيمًا مرتبطًا بمولد غير موجود', () => {
    reject(backup([gen('a')], [log('1', 'zz', '2026-10-01')]), 'بمولد غير موجود');
  });

  it('يرفض أكثر من سجل للمولد نفسه في اليوم نفسه', () => {
    reject(
      backup(
        [gen('a')],
        [
          log('1', 'a', '2026-10-01'),
          log('2', 'a', '2026-10-01', { createdAt: '2026-10-01T11:00:00.000Z' }),
        ]
      ),
      'أكثر من سجل'
    );
  });

  it('يرفض القيم السالبة وغير الرقمية وأنواع السجلات غير الصحيحة والملاحظات الطويلة', () => {
    reject(backup([gen('a')], [log('1', 'a', '2026-10-01', { previousReading: -1 })]), 'سالبة');
    reject(
      backup([gen('a')], [log('1', 'a', '2026-10-01', { currentReading: 'abc' })]),
      'ليست أرقامًا'
    );
    reject(backup([gen('a')], [log('1', 'a', '2026-10-01', { recordType: 'fuel' })]), 'نوع السجل');
    reject(
      backup([gen('a')], [log('1', 'a', '2026-10-01', { notes: 'أ'.repeat(501) })]),
      'ملاحظات السجل'
    );
  });

  it('يرفض التواريخ غير الصالحة والمستقبلية وكسر قاعدة السجل اليومي', () => {
    reject(backup([gen('a')], [log('1', 'a', '2026-02-30')]), 'غير صالح');
    reject(backup([gen('a')], [log('1', 'a', '2026-10-20')]), 'مستقبليًا');
    reject(
      backup([gen('a')], [log('1', 'a', '2026-10-01', { previousReading: 10, currentReading: 5 })]),
      'أقل من السابقة'
    );
  });

  it('يرفض تسلسلًا زمنيًا يخالف قاعدة منع السجلات السابقة', () => {
    reject(
      backup(
        [gen('a')],
        [
          log('1', 'a', '2026-10-05', { createdAt: '2026-10-05T10:00:00.000Z' }),
          log('2', 'a', '2026-10-03', { createdAt: '2026-10-06T10:00:00.000Z' }),
        ]
      ),
      'تسلسل'
    );
  });

  it('يعيد حساب اليوم من التاريخ وساعات التشغيل من القراءات بدقة عشرية (تغيير العداد = صفر)', () => {
    const out = validateBackup(valid(), TODAY);
    expect(out.logs.map(l => l.day)).toEqual(['الخميس', 'الجمعة', 'الجمعة']);
    expect(out.logs.map(l => l.operatingHours)).toEqual([10, 0, 4]);
  });

  it('يسوّي أكثر من مولد افتراضي إلى واحد نشط فقط', () => {
    const out = validateBackup(
      backup(
        [
          gen('a', { isDefault: true, status: 'inactive' }),
          gen('b', { isDefault: true }),
          gen('c', { isDefault: true }),
        ],
        []
      ),
      TODAY
    );
    expect(out.generators.map(g => g.isDefault)).toEqual([false, true, false]);
  });

  it('يستورد نسخة 1.0 قديمة بلا isDefault أو إحداثيات دون خطأ ويحافظ على الحقول القديمة', () => {
    const old = valid();
    const out = validateBackup(old, TODAY);
    expect(out.generators.map(g => g.isDefault)).toEqual([false, false]);
    expect(Object.keys(out.generators[0])).toEqual(
      expect.arrayContaining(Object.keys(old.generators[0]))
    );
    expect(Object.keys(out.logs[0])).toEqual(expect.arrayContaining(Object.keys(old.logs[0])));
    expect(out.version).toBe('1.0');
  });

  it('لا يثق بالإحصاءات المشتقة المخزنة في الملف', () => {
    const out = validateBackup({ ...valid(), stats: { total: 9999 } }, TODAY);
    expect(out).not.toHaveProperty('stats');
  });

  it('لا يغير البيانات الحالية عند فشل الاستعادة، وينزل نسخة أمان أولًا', async () => {
    const current = backup([gen('x')], [log('1', 'x', '2026-10-01')]);
    const snapshot = structuredClone(current);
    const apply = vi.fn();
    const safety = vi.fn(() => true);
    await expect(
      restoreBackup(file({ ...valid(), version: '9' }), current, apply, safety)
    ).rejects.toThrow('لم يتم تعديل البيانات الحالية');
    expect(safety).toHaveBeenCalledWith(current);
    expect(apply).not.toHaveBeenCalled();
    expect(current).toEqual(snapshot);
  });

  it('يلغي الاستعادة إذا تعذر تنزيل نسخة الأمان', async () => {
    const apply = vi.fn();
    await expect(restoreBackup(file(valid()), backup([], []), apply, () => false)).rejects.toThrow(
      'نسخة الأمان'
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('يطبق البيانات المستعادة عند نجاح التحقق', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    const apply = vi.fn();
    await restoreBackup(file(valid()), backup([], []), apply, () => true);
    vi.useRealTimers();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].logs).toHaveLength(3);
  });

  it('المسح الشامل يتطلب كتابة كلمة التأكيد «مسح» حرفيًا', () => {
    expect(isWipeConfirmed('مسح')).toBe(true);
    expect(isWipeConfirmed(' مسح ')).toBe(true);
    expect(isWipeConfirmed('')).toBe(false);
    expect(isWipeConfirmed('نعم')).toBe(false);
    expect(isWipeConfirmed(undefined)).toBe(false);
  });

  it('المسح الشامل ينزل نسخة أمان من البيانات الحالية أولًا ثم يمسح', () => {
    const current = backup([gen('a')], []);
    const order = [];
    wipeAllData(
      current,
      () => order.push('clear'),
      d => {
        order.push(['backup', d]);
        return true;
      }
    );
    expect(order).toEqual([['backup', current], 'clear']);
  });

  it('لا يمسح شيئًا إذا تعذر بدء تنزيل نسخة الأمان', () => {
    const clear = vi.fn();
    expect(() => wipeAllData(backup([], []), clear, () => false)).toThrow('لم يُمسح أي شيء');
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('ربط ملف نسخة احتياطية (File System Access API)', () => {
  const fakeHandle = () => {
    const writes = [];
    return {
      writes,
      handle: {
        name: 'my-backup.json',
        createWritable: async () => ({ write: async t => writes.push(t), close: async () => {} }),
      },
    };
  };

  it('غير مدعوم دون showSaveFilePicker: لا ربط', async () => {
    const m = await import('./backupService');
    expect(m.isFileSystemAccessSupported()).toBe(false);
    expect(await m.linkBackupFile()).toBe(false);
    expect(m.hasLinkedBackupFile()).toBe(false);
  });

  it('الربط يحفظ اسم الملف، والكتابة والنسخ التلقائي يحدّثان الملف، وإلغاء الربط يوقفه', async () => {
    const m = await import('./backupService');
    const { writes, handle } = fakeHandle();
    globalThis.window = { showSaveFilePicker: vi.fn(async () => handle) };
    try {
      expect(m.isFileSystemAccessSupported()).toBe(true);
      expect(await m.linkBackupFile()).toBe(true);
      expect(m.linkedBackupFileName()).toBe('my-backup.json');
      expect(await m.writeLinkedBackup({ version: '1.0', generators: [gen('a')], logs: [], meta: {} })).toBe(true);
      expect(JSON.parse(writes[0]).generators[0].id).toBe('a');
      m.downloadBackup({ version: '1.0', generators: [], logs: [], meta: {} });
      await new Promise(r => setTimeout(r, 0));
      expect(writes).toHaveLength(2);
      m.unlinkBackupFile();
      expect(m.hasLinkedBackupFile()).toBe(false);
      expect(await m.writeLinkedBackup({ meta: {} })).toBe(false);
    } finally {
      m.unlinkBackupFile();
      delete globalThis.window;
    }
  });

  it('إلغاء المستخدم لنافذة اختيار الملف لا يربط شيئًا', async () => {
    const m = await import('./backupService');
    globalThis.window = { showSaveFilePicker: async () => { throw new Error('AbortError'); } };
    try {
      expect(await m.linkBackupFile()).toBe(false);
      expect(m.hasLinkedBackupFile()).toBe(false);
    } finally {
      delete globalThis.window;
    }
  });
});

describe('تغيير العداد بساعات فعلية', () => {
  it('الاستعادة تحسب ساعات تغيير العداد من الفرق، وتقبل السجل القديم (الحالية أقل) بصفر ساعة', () => {
    const out = validateBackup(
      backup(
        [gen('a')],
        [
          log('1', 'a', '2026-09-07', { previousReading: 15867.5, currentReading: 15871.5, operatingHours: 4 }),
          log('2', 'a', '2026-09-08', { recordType: 'meterReset', previousReading: 15749, currentReading: 15754, operatingHours: 0 }),
          log('3', 'a', '2026-09-09', { previousReading: 15754, currentReading: 15759, operatingHours: 5 }),
          log('4', 'a', '2026-09-10', { recordType: 'meterReset', previousReading: 15759, currentReading: 10, operatingHours: 7 }),
        ]
      ),
      TODAY
    );
    expect(out.logs.map(l => l.operatingHours)).toEqual([4, 5, 5, 0]);
  });
});
