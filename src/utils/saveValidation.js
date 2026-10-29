import { isValidISODate } from './dates';
import { localTodayISO } from '../domain/models';

export function assertSaveDate(value) {
  if (!isValidISODate(value)) throw new Error('أدخل تاريخًا صالحًا للسجل');
  if (value > localTodayISO()) throw new Error('لا يُسمح بتسجيل تاريخ مستقبلي');
}

export function assertTransaction(payload) {
  if (!payload.asset_id) throw new Error('اختر الأصل أولًا');
  assertSaveDate(payload.transaction_date);
  if (payload.quantity === '' || payload.quantity == null || !Number.isFinite(Number(payload.quantity)) || Number(payload.quantity) <= 0) throw new Error('الكمية مطلوبة ويجب أن تكون أكبر من صفر');
  if (String(payload.transaction_type).startsWith('adjustment_') && !String(payload.adjustment_reason || '').trim()) throw new Error('سبب التسوية مطلوب');
}

export function assertOperation(payload) {
  if (!payload.asset_id) throw new Error('اختر الأصل أولًا');
  assertSaveDate(payload.operation_date);
  // A meterless category omits the reading keys (or sends empty/null); the database
  // still owns category eligibility, chronology, previous reading and dynamic fields.
  for (const key of ['previous_reading', 'current_reading', 'chlorine_consumed', 'residual_chlorine']) {
    const value = payload[key];
    if (value !== '' && value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error('القراءات والاستهلاك يجب أن تكون أرقامًا موجبة أو صفرًا');
  }
  if (payload.record_type !== 'meter_reset' && payload.previous_reading !== '' && payload.current_reading !== '' && payload.previous_reading != null && payload.current_reading != null && Number(payload.current_reading) < Number(payload.previous_reading)) throw new Error('القراءة الحالية لا تقل عن السابقة في السجل اليومي');
}
