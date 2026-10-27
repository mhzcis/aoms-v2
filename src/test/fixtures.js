// بيانات اختبار مشتركة. تاريخ اليوم في الاختبارات مثبت على 2026-10-19.
export const TODAY = '2026-10-19';
export const gen = (id, extra = {}) => ({ id, number: `G-${id}`, name: `مولد ${id}`, location: 'الموقع', capacity: '', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra });
export const log = (id, generatorId, date, extra = {}) => ({ id, generatorId, date, day: '', recordType: 'daily', previousReading: 0, currentReading: 0, operatingHours: 0, notes: '', createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, edited: false, ...extra });
export const memoryStorage = () => { const store = {}; return { store, getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i] ?? null, get length() { return Object.keys(store).length; } }; };
