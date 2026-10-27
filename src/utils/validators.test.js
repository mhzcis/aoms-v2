import { describe, expect, it } from 'vitest';
import { validateGenerator, validateLog } from './validators';

describe('التحقق', () => {
  it('يرفض رقم مولد مكرر', () =>
    expect(
      validateGenerator(
        { id: '2', number: 'G1', name: 'ب', location: 'م', capacity: '' },
        [{ id: '1', number: 'g1' }]
      ).number
    ).toBeTruthy());

  it('يرفض قراءة يومية أقل', () =>
    expect(
      validateLog(
        {
          id: '',
          generatorId: 'g',
          date: '2025-01-01',
          recordType: 'daily',
          previousReading: 10,
          currentReading: 2,
          notes: '',
        },
        []
      ).currentReading
    ).toBeTruthy());

  it('تغيير العداد: القراءة الحالية لا تقل عن قراءة بداية العداد الجديد، والمساواة مقبولة', () => {
    const m = (previousReading, currentReading) =>
      validateLog(
        { id: '', generatorId: 'g', date: '2025-01-01', recordType: 'meterReset', previousReading, currentReading, notes: '' },
        []
      ).currentReading;
    expect(m(10, 0)).toBe('القراءة الحالية لا تقل عن قراءة بداية العداد الجديد');
    expect(m(15749, 15749)).toBeUndefined();
    expect(m(15749, 15754)).toBeUndefined();
  });

  it('يقبل إحداثيات العرض والطول الاختيارية الفارغة أو الصالحة ويرفض الخارجة عن النطاق', () => {
    const base = { id: '1', number: 'G1', name: 'مولد 1', location: 'غزة', capacity: '' };
    expect(validateGenerator({ ...base, latitude: '', longitude: '' }, [])).toEqual({});
    expect(validateGenerator({ ...base, latitude: '31.3461', longitude: '34.3064' }, [])).toEqual({});
    expect(validateGenerator({ ...base, latitude: '95', longitude: '34' }, []).latitude).toBeTruthy();
    expect(validateGenerator({ ...base, latitude: '-91', longitude: '34' }, []).latitude).toBeTruthy();
    expect(validateGenerator({ ...base, latitude: '31', longitude: '185' }, []).longitude).toBeTruthy();
    expect(validateGenerator({ ...base, latitude: '31', longitude: '-181' }, []).longitude).toBeTruthy();
  });
});
