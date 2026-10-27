import { stamp, isoNow, dayName, isValidISODate, todayISO } from '../utils/dates';
import { isValidCoordinate, normalizeNumber } from '../utils/validators';
import { normalizeDefaultGenerator } from '../utils/generators';
import { logHours } from '../utils/calculations';

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024; // 5 MB

let linkedFileHandle = null;

export const isFileSystemAccessSupported = () =>
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

export const hasLinkedBackupFile = () => !!linkedFileHandle;

export const linkedBackupFileName = () => linkedFileHandle?.name || null;

export const unlinkBackupFile = () => {
  linkedFileHandle = null;
};

export const linkBackupFile = async () => {
  if (!isFileSystemAccessSupported()) return false;
  try {
    linkedFileHandle = await window.showSaveFilePicker({
      suggestedName: `generator-backup-${stamp()}.json`,
      types: [
        {
          description: 'JSON Backup File',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
    return !!linkedFileHandle;
  } catch {
    return false;
  }
};

export const writeLinkedBackup = async data => {
  if (!linkedFileHandle) return false;
  try {
    const payload = JSON.stringify(
      { ...data, meta: { ...data.meta, lastBackupAt: isoNow() }, exportedAt: isoNow() },
      null,
      2
    );
    const writable = await linkedFileHandle.createWritable();
    await writable.write(payload);
    await writable.close();
    return true;
  } catch {
    return false;
  }
};

// يعيد true عند إطلاق التنزيل فعليًا، وfalse إذا تعذر ذلك. لا يمكن للمتصفح تأكيد حفظ الملف على القرص.
const download = (text, name, type = 'application/json') => {
  try {
    if (typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    if (!('download' in a)) return false;
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
};

// تنزيل القيمة الخام للبيانات التالفة كما هي (نص) لمراجعتها أو إصلاحها يدويًا.
export const downloadCorruptRaw = raw =>
  download(String(raw ?? ''), `generator-data-corrupt-${stamp()}.txt`, 'text/plain;charset=utf-8');

export const downloadBackup = data => {
  const payload = JSON.stringify(
    { ...data, meta: { ...data.meta, lastBackupAt: isoNow() }, exportedAt: isoNow() },
    null,
    2
  );
  if (linkedFileHandle) {
    writeLinkedBackup(data).catch(() => {});
  }
  return download(payload, `generator-backup-${stamp()}.json`);
};

const RECORD_TYPES = ['daily', 'meterReset'];
const isReading = v => v !== '' && v !== null && typeof v !== 'boolean' && Number.isFinite(Number(v));
const fail = text => {
  throw new Error(`تعذرت الاستعادة: ${text}. لم يتم تعديل البيانات الحالية.`);
};

const sanitizeObject = obj => {
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
      clean[k] = v;
    }
  }
  return clean;
};

// يتحقق من بنية النسخة الاحتياطية ويعيد بيانات مُطبَّعة، أو يرمي خطأ بسبب الرفض دون أي أثر جانبي.
// سياسة ساعات التشغيل: تُعاد حسابها دائمًا من القراءات عبر logHours (الحالية - السابقة لكلا النوعين؛
// وسجل تغيير العداد القديم الذي قراءته الحالية أقل من السابقة يُقبل بصفر ساعة للتوافق مع النسخ القديمة).
export const validateBackup = (x, today = todayISO()) => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) fail('بنية الملف غير صالحة');
  if (x.version !== '1.0') fail(`إصدار النسخة الاحتياطية «${x.version ?? 'غير محدد'}» غير مدعوم`);
  if (!Array.isArray(x.generators) || !Array.isArray(x.logs)) {
    fail('قائمتا المولدات والسجلات مفقودتان أو غير صالحتين');
  }

  const ids = new Set();
  const numbers = new Set();

  const sanitizedGenerators = x.generators.map((g, i) => {
    const n = i + 1;
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !g.id) {
      fail(`المولد رقم ${n} لا يحتوي معرّفًا صالحًا`);
    }
    if (ids.has(g.id)) fail(`معرّف المولد رقم ${n} مكرر`);
    if (!normalizeNumber(g.number)) fail(`المولد رقم ${n} بلا رقم مولد`);
    if (numbers.has(normalizeNumber(g.number))) {
      fail(`رقم المولد «${String(g.number).trim()}» مكرر`);
    }
    if (typeof g.name !== 'string' || !g.name.trim()) {
      fail(`المولد رقم ${n} بلا اسم صالح`);
    }
    if (typeof g.location !== 'string' || !g.location.trim()) {
      fail(`المولد رقم ${n} بلا موقع صالح`);
    }
    if (!['active', 'inactive'].includes(g.status)) {
      fail(`حالة المولد «${g.number}» غير صالحة`);
    }
    if (g.capacity !== undefined && g.capacity !== '' && (!Number.isFinite(Number(g.capacity)) || Number(g.capacity) < 0)) {
      fail(`قدرة المولد «${g.number}» غير صالحة`);
    }
    if (!isValidCoordinate(g.latitude, -90, 90)) {
      fail(`إحداثيات العرض للمولد «${g.number}» غير صالحة`);
    }
    if (!isValidCoordinate(g.longitude, -180, 180)) {
      fail(`إحداثيات الطول للمولد «${g.number}» غير صالحة`);
    }
    ids.add(g.id);
    numbers.add(normalizeNumber(g.number));
    return sanitizeObject(g);
  });

  const logIds = new Set();
  const days = new Set();

  const logs = x.logs.map((l, i) => {
    const n = i + 1;
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !l.id) {
      fail(`السجل رقم ${n} لا يحتوي معرّفًا صالحًا`);
    }
    if (logIds.has(l.id)) fail(`معرّف السجل رقم ${n} مكرر`);
    logIds.add(l.id);
    if (!ids.has(l.generatorId)) fail(`السجل رقم ${n} مرتبط بمولد غير موجود`);
    if (!isValidISODate(l.date)) fail(`تاريخ السجل رقم ${n} غير صالح`);
    if (l.date > today) fail(`السجل رقم ${n} يحمل تاريخًا مستقبليًا (${l.date})`);
    if (days.has(`${l.generatorId}|${l.date}`)) {
      fail(`يوجد أكثر من سجل للمولد نفسه في تاريخ ${l.date}`);
    }
    days.add(`${l.generatorId}|${l.date}`);
    if (!RECORD_TYPES.includes(l.recordType)) fail(`نوع السجل رقم ${n} غير صالح`);
    if (!isReading(l.previousReading) || !isReading(l.currentReading)) {
      fail(`قراءات السجل رقم ${n} ليست أرقامًا صالحة`);
    }
    const previousReading = Number(l.previousReading);
    const currentReading = Number(l.currentReading);
    if (previousReading < 0 || currentReading < 0) fail(`السجل رقم ${n} يحتوي قراءة سالبة`);
    if (l.recordType === 'daily' && currentReading < previousReading) {
      fail(`القراءة الحالية في السجل اليومي رقم ${n} أقل من السابقة`);
    }
    if (typeof l.createdAt !== 'string' || !l.createdAt) {
      fail(`السجل رقم ${n} بلا تاريخ إنشاء`);
    }
    if (l.notes !== undefined && l.notes !== null && (typeof l.notes !== 'string' || l.notes.length > 500)) {
      fail(`ملاحظات السجل رقم ${n} غير صالحة أو تتجاوز 500 حرف`);
    }
    return {
      ...sanitizeObject(l),
      day: dayName(l.date),
      previousReading,
      currentReading,
      operatingHours: logHours(l.recordType, previousReading, currentReading),
    };
  });

  // التسلسل الزمني لكل مولد: السجل المُنشأ لاحقًا يجب أن يحمل تاريخًا أحدث، لأن إضافة سجل بتاريخ سابق ممنوعة.
  const byGenerator = {};
  logs.forEach(l => (byGenerator[l.generatorId] ??= []).push(l));
  Object.values(byGenerator).forEach(list => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach((l, i) => {
      if (i && l.createdAt < sorted[i - 1].createdAt) {
        fail(`تسلسل سجلات المولد غير صحيح: سجل ${l.date} أُنشئ قبل سجل أقدم منه تاريخًا (${sorted[i - 1].date})`);
      }
    });
  });

  return {
    version: '1.0',
    generators: normalizeDefaultGenerator(sanitizedGenerators),
    logs,
    meta: x.meta && typeof x.meta === 'object' && !Array.isArray(x.meta) ? sanitizeObject(x.meta) : {},
  };
};

export const parseBackup = async file => {
  if (file && typeof file.size === 'number' && file.size > MAX_BACKUP_BYTES) {
    fail('حجم الملف يتجاوز الحد الأقصى المسموح به (5 ميجابايت)');
  }
  let x;
  try {
    x = JSON.parse(await file.text());
  } catch {
    fail('الملف تالف أو ليس ملف JSON صالحًا');
  }
  return validateBackup(x);
};

// الاستعادة: نسخة أمان من البيانات الحالية أولًا، ثم التحقق الكامل، ثم الاستبدال فقط عند نجاح كل شيء.
export const restoreBackup = async (file, current, apply, backup = downloadBackup) => {
  if (!backup(current)) fail('تعذر بدء تنزيل نسخة الأمان من البيانات الحالية');
  const next = await parseBackup(file);
  apply(next);
  return next;
};

// المسح الشامل: كلمة التأكيد المطلوبة، ثم نسخة أمان أولًا، ولا يُمسح شيء إذا تعذر بدء تنزيلها.
export const WIPE_CONFIRM_WORD = 'مسح';
export const isWipeConfirmed = text => String(text ?? '').trim() === WIPE_CONFIRM_WORD;
export const wipeAllData = (current, clear, backup = downloadBackup) => {
  if (!backup(current)) {
    throw new Error('تعذر بدء تنزيل نسخة الأمان، لذلك لم يُمسح أي شيء. اسمح بالتنزيلات لهذا الموقع ثم أعد المحاولة.');
  }
  clear();
  return true;
};
