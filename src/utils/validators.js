import { niceDate, todayISO } from './dates';
import { previousLog } from './calculations';

export const normalizeNumber = v => String(v ?? '').trim().toLowerCase();

export const isValidCoordinate = (value, min, max) => {
  if (value === undefined || value === null || String(value).trim() === '') return true;
  if (typeof value === 'boolean') return false;
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max;
};

export function validateGenerator(g, generators) {
  const e = {};
  if (!String(g.number ?? '').trim()) e.number = 'رقم المولد مطلوب';
  if (!String(g.name ?? '').trim()) e.name = 'اسم المولد مطلوب';
  if (!String(g.location ?? '').trim()) e.location = 'الموقع مطلوب';
  if (generators.some(x => x.id !== g.id && normalizeNumber(x.number) === normalizeNumber(g.number))) {
    e.number = 'رقم المولد مستخدم مسبقًا';
  }
  if (g.capacity !== undefined && g.capacity !== '' && (!Number.isFinite(Number(g.capacity)) || Number(g.capacity) < 0)) {
    e.capacity = 'القدرة يجب أن تكون رقمًا غير سالب';
  }
  if (!isValidCoordinate(g.latitude, -90, 90)) {
    e.latitude = 'إحداثيات العرض يجب أن تكون رقمًا بين -90 و 90';
  }
  if (!isValidCoordinate(g.longitude, -180, 180)) {
    e.longitude = 'إحداثيات الطول يجب أن تكون رقمًا بين -180 و 180';
  }
  return e;
}

export function validateLog(log, logs) {
  const e = {};
  if (!log.generatorId) e.generatorId = 'اختر المولد';
  if (!log.date) e.date = 'التاريخ مطلوب';
  else if (log.date > todayISO()) e.date = 'لا يسمح بتاريخ مستقبلي';

  if (logs.some(x => x.id !== log.id && x.generatorId === log.generatorId && x.date === log.date)) {
    e.date = 'يوجد سجل لهذا المولد في التاريخ نفسه';
  }

  const prev = log.generatorId ? previousLog(logs, log.generatorId, log.id) : null;
  if (prev && !log.id && prev.date >= todayISO()) {
    e.date = 'يوجد سجل لهذا المولد بتاريخ اليوم، ولا يمكن إضافة سجل آخر قبل اليوم التالي';
  } else if (prev && log.date && !e.date && log.date <= prev.date) {
    e.date = `يجب أن يكون التاريخ بعد ${niceDate(prev.date)}، تاريخ آخر سجل سابق لهذا المولد`;
  }

  for (const k of ['previousReading', 'currentReading']) {
    if (log[k] === '' || log[k] === null || typeof log[k] === 'boolean' || !Number.isFinite(Number(log[k])) || Number(log[k]) < 0) {
      e[k] = 'أدخل رقمًا غير سالب';
    }
  }

  if (Number(log.currentReading) < Number(log.previousReading)) {
    e.currentReading =
      log.recordType === 'meterReset'
        ? 'القراءة الحالية لا تقل عن قراءة بداية العداد الجديد'
        : 'القراءة الحالية لا تقل عن السابقة في السجل اليومي';
  }

  if ((log.notes || '').length > 500) e.notes = 'الحد الأقصى 500 حرف';
  return e;
}
