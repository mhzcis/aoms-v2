import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dailyChart,
  GENERATOR_COLORS,
  generatorColor,
  logDateRule,
  logHours,
  monthlyByGenerator,
  roundHours,
  totalHours,
} from './calculations';
import { validateLog } from './validators';
import { applyGenerator, editLogForm, newLogForm, noLogsLink } from './logForm';
import { gen, log } from '../test/fixtures';

const form = (extra = {}) => ({
  generatorId: 'a',
  date: '2026-10-19',
  recordType: 'daily',
  previousReading: 0,
  currentReading: 0,
  notes: '',
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 19, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe('السجلات والتواريخ', () => {
  it('أول سجل يسمح بتاريخ اليوم أو تاريخ سابق غير مستقبلي، والافتراضي هو اليوم', () => {
    const rule = logDateRule([], 'a');
    expect(rule).toMatchObject({
      prev: null,
      min: '',
      max: '2026-10-19',
      defaultDate: '2026-10-19',
      blocked: false,
    });
    expect(validateLog(form({ date: '2026-10-19' }), []).date).toBeUndefined();
    expect(validateLog(form({ date: '2025-03-01' }), []).date).toBeUndefined();
  });

  it('السجل التالي يأخذ افتراضيًا تاريخ أحدث سجل + يوم واحد، ويبدأ الحد الأدنى منه', () => {
    const logs = [
      log('1', 'a', '2026-10-10'),
      log('2', 'a', '2026-10-15'),
      log('3', 'b', '2026-10-18'),
    ];
    expect(logDateRule(logs, 'a')).toMatchObject({
      min: '2026-10-16',
      defaultDate: '2026-10-16',
      blocked: false,
    });
    expect(newLogForm([gen('a', { isDefault: true })], logs).date).toBe('2026-10-16');
  });

  it('يحسب اليوم التالي بشكل صحيح عبر نهاية الشهر', () => {
    expect(logDateRule([log('1', 'a', '2026-09-30')], 'a').defaultDate).toBe('2026-10-01');
  });

  it('يرفض تاريخًا يساوي أحدث سجل للمولد', () => {
    expect(validateLog(form({ date: '2026-10-15' }), [log('1', 'a', '2026-10-15')]).date).toBeTruthy();
  });

  it('يرفض تاريخًا أقدم من أحدث سجل للمولد، ولا يتأثر بسجلات مولد آخر', () => {
    const logs = [log('1', 'a', '2026-10-15'), log('2', 'b', '2026-10-18')];
    expect(validateLog(form({ date: '2026-10-12' }), logs).date).toContain('بعد 15/10/2026');
    expect(validateLog(form({ date: '2026-10-16' }), logs).date).toBeUndefined();
  });

  it('يرفض التاريخ المستقبلي', () => {
    expect(validateLog(form({ date: '2026-10-20' }), []).date).toBe('لا يسمح بتاريخ مستقبلي');
    expect(validateLog(form({ date: '2026-10-20' }), [log('1', 'a', '2026-10-15')]).date).toBe(
      'لا يسمح بتاريخ مستقبلي'
    );
  });

  it('يعطل الإضافة إذا كان أحدث سجل للمولد بتاريخ اليوم، في الواجهة وفي طبقة التحقق', () => {
    const logs = [log('1', 'a', '2026-10-19')];
    expect(logDateRule(logs, 'a')).toMatchObject({ blocked: true, defaultDate: '' });
    expect(validateLog(form({ date: '2026-10-18' }), logs).date).toBe(
      'يوجد سجل لهذا المولد بتاريخ اليوم، ولا يمكن إضافة سجل آخر قبل اليوم التالي'
    );
  });

  it('يعيد حساب التاريخ والقراءة السابقة عند تغيير المولد في النموذج', () => {
    const logs = [
      log('1', 'a', '2026-10-10', { currentReading: 50 }),
      log('2', 'b', '2026-10-17', { currentReading: 900 }),
    ];
    const f = newLogForm([gen('a', { isDefault: true }), gen('b'), gen('c')], logs);
    expect(f).toMatchObject({ generatorId: 'a', date: '2026-10-11', previousReading: '50' });
    expect(applyGenerator(f, logs, 'b')).toMatchObject({
      generatorId: 'b',
      date: '2026-10-18',
      previousReading: '900',
    });
    expect(applyGenerator(f, logs, 'c')).toMatchObject({
      generatorId: 'c',
      date: '2026-10-19',
      previousReading: '',
    });
  });

  it('تعديل آخر سجل لا يمكن أن يسبق أو يساوي السجل السابق ولا يتجاوز اليوم', () => {
    const logs = [log('1', 'a', '2026-10-10'), log('2', 'a', '2026-10-15')];
    expect(logDateRule(logs, 'a', '2').min).toBe('2026-10-11');
    expect(validateLog(form({ id: '2', date: '2026-10-09' }), logs).date).toBeTruthy();
    expect(validateLog(form({ id: '2', date: '2026-10-10' }), logs).date).toBeTruthy();
    expect(validateLog(form({ id: '2', date: '2026-10-20' }), logs).date).toBe('لا يسمح بتاريخ مستقبلي');
    expect(validateLog(form({ id: '2', date: '2026-10-11' }), logs).date).toBeUndefined();
    expect(validateLog(form({ id: '1', date: '2026-10-10' }), [log('1', 'a', '2026-10-10')]).date).toBeUndefined();
  });

  it('يستمر في منع سجلين للمولد نفسه في اليوم نفسه', () => {
    expect(validateLog(form({ date: '2026-10-15' }), [log('1', 'a', '2026-10-15')]).date).toBe(
      'يوجد سجل لهذا المولد في التاريخ نفسه'
    );
    expect(
      validateLog(form({ generatorId: 'b', date: '2026-10-15' }), [log('1', 'a', '2026-10-15')]).date
    ).toBeUndefined();
  });
});

describe('القراءات ودقة الحسابات', () => {
  it('القراءة السابقة تأتي من القراءة الحالية لأحدث سجل للمولد', () => {
    const logs = [
      log('1', 'a', '2026-10-05', { currentReading: 10 }),
      log('2', 'a', '2026-10-12', { currentReading: 40 }),
    ];
    expect(newLogForm([gen('a', { isDefault: true })], logs).previousReading).toBe('40');
    expect(editLogForm({ ...logs[1], previousReading: 7 }, logs).previousReading).toBe('10');
  });

  it('يرفض القراءة الأقل في السجل اليومي', () => {
    expect(
      validateLog(form({ previousReading: 10, currentReading: 2, date: '2025-01-01' }), []).currentReading
    ).toBeTruthy();
  });

  it('يرفض في تغيير العداد قراءة حالية أقل من قراءة بداية العداد الجديد', () => {
    expect(
      validateLog(
        form({ recordType: 'meterReset', previousReading: 10, currentReading: 0, date: '2025-01-01' }),
        []
      ).currentReading
    ).toBe('القراءة الحالية لا تقل عن قراءة بداية العداد الجديد');
  });

  it('ساعات تغيير العداد = الحالية - بداية العداد الجديد، والسجل القديم (الحالية أقل) بصفر ساعة', () => {
    expect(logHours('meterReset', 15749, 15754)).toBe(5);
    expect(logHours('meterReset', 15749, 15749)).toBe(0);
    expect(logHours('meterReset', 110, 5)).toBe(0);
    expect(logHours('daily', 100.1, 100.3)).toBe(0.2);
  });

  it('تغيير العداد بساعات فعلية: يُحتسب في الإجمالي، والسجل التالي يتسلسل من قراءته الحالية، وتعديله يحتفظ بقراءة بداية العداد الجديد', () => {
    const logs = [
      log('1', 'a', '2026-10-01', { previousReading: 15867.5, currentReading: 15871.5, operatingHours: 4 }),
      log('2', 'a', '2026-10-02', { recordType: 'meterReset', previousReading: 15749, currentReading: 15754, operatingHours: 5 }),
    ];
    expect(totalHours(logs)).toBe(9);
    expect(newLogForm([gen('a', { isDefault: true })], logs)).toMatchObject({ previousReading: '15754', date: '2026-10-03' });
    expect(editLogForm(logs[1], logs).previousReading).toBe(15749);
    expect(editLogForm({ ...logs[1], recordType: 'daily' }, logs).previousReading).toBe('15871.5');
  });

  it('توافق قديم: تغيير عداد بقراءة أقل وصفر ساعة، والقراءة الجديدة أساس السجل التالي، ويبقى الإجمالي التاريخي صحيحًا', () => {
    const logs = [
      log('1', 'a', '2026-10-01', { previousReading: 100, currentReading: 110, operatingHours: 10 }),
      log('2', 'a', '2026-10-02', {
        recordType: 'meterReset',
        previousReading: 110,
        currentReading: 5,
        operatingHours: 0,
      }),
    ];
    const next = newLogForm([gen('a', { isDefault: true })], logs);
    expect(next).toMatchObject({ previousReading: '5', date: '2026-10-03' });
    const third = log('3', 'a', next.date, {
      previousReading: Number(next.previousReading),
      currentReading: 12,
      operatingHours: 12 - Number(next.previousReading),
    });
    expect(third.operatingHours).toBe(7);
    expect(totalHours([...logs, third])).toBe(17);
  });

  it('يعالج أخطاء الفاصلة العائمة العشرية (IEEE-754) بدقة ويعرض تاريخ اليوم المحلي في الرسم اليومي', () => {
    expect(roundHours(100.3 - 100.1)).toBe(0.2);
    expect(totalHours([{ operatingHours: 0.1 }, { operatingHours: 0.2 }])).toBe(0.3);
    const chart = dailyChart([log('1', 'a', '2026-10-19', { operatingHours: 0.1 + 0.2 })]);
    expect(chart.at(-1)).toEqual({ date: '10-19', hours: 0.3 });
  });
});

describe('الواجهة: النموذج والرسم واللوحة', () => {
  it('نموذج سجل جديد يختار المولد الافتراضي النشط تلقائيًا', () => {
    expect(newLogForm([gen('a'), gen('b', { isDefault: true })], []).generatorId).toBe('b');
    expect(newLogForm([gen('a'), gen('b')], []).generatorId).toBe('');
  });

  it('المولد المطلوب من لوحة التحكم يتقدم على الافتراضي، ولا يُختار مولد غير نشط', () => {
    expect(newLogForm([gen('a', { isDefault: true }), gen('b')], [], 'b')).toMatchObject({
      generatorId: 'b',
      date: '2026-10-19',
      previousReading: '',
    });
    expect(
      newLogForm([gen('a', { isDefault: true }), gen('b', { status: 'inactive' })], [], 'b').generatorId
    ).toBe('a');
  });

  it('رابط مولد بلا سجلات يفتح نموذج السجل الجديد للمولد', () => {
    expect(noLogsLink(gen('x'))).toBe('/logs?generator=x&new=1');
    expect(noLogsLink(gen('y', { status: 'inactive' }))).toBe('/logs?generator=y');
  });

  it('الرسم الشهري يعطي لونًا مختلفًا وثابتًا لكل مولد', () => {
    const generators = Array.from({ length: 20 }, (_, i) => gen(String(i)));
    const first = monthlyByGenerator(generators, []);
    const again = monthlyByGenerator(generators, []);
    expect(new Set(first.map(x => x.color)).size).toBe(20);
    expect(again.map(x => x.color)).toEqual(first.map(x => x.color));
    expect(first[0]).toMatchObject({ id: '0', name: 'مولد 0', hours: 0, color: GENERATOR_COLORS[0] });
    expect(generatorColor(15)).toBe(generatorColor(15));
  });
});
