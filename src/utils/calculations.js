import { currentMonth, daysAgoISO, nextDay, todayISO } from './dates';

export const roundHours = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

// ساعات تشغيل السجل:
// - السجل اليومي: الحالية - السابقة.
// - تغيير العداد: القراءة السابقة هي قراءة بداية العداد الجديد، والساعات = الحالية - السابقة (قد تكون صفرًا).
// - توافق مع البيانات القديمة: سجل تغيير عداد قراءته الحالية أقل من السابقة (القاعدة القديمة: السابقة من العداد القديم) يُحسب بصفر ساعة.
export const logHours = (recordType, previousReading, currentReading) => {
  const prev = Number(previousReading || 0);
  const curr = Number(currentReading || 0);
  if (recordType === 'meterReset' && curr < prev) return 0;
  return roundHours(curr - prev);
};

export const sortLogs = logs =>
  [...logs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

export const generatorLogs = (logs, id) => sortLogs(logs.filter(x => x.generatorId === id));

export const latestLog = (logs, id) => generatorLogs(logs, id)[0] || null;

export const totalHours = logs =>
  roundHours(logs.reduce((s, x) => s + Number(x.operatingHours || 0), 0));

export const dashboardStats = (generators, logs) => {
  const totals = generators
    .map(g => ({ g, h: totalHours(logs.filter(x => x.generatorId === g.id)) }))
    .sort((a, b) => b.h - a.h);
  return {
    count: generators.length,
    active: generators.filter(g => g.status === 'active').length,
    total: totalHours(logs),
    month: totalHours(logs.filter(x => x.date.startsWith(currentMonth()))),
    top: totals[0]?.h ? totals[0] : null,
    today: totalHours(logs.filter(x => x.date === todayISO())),
  };
};

export const dailyChart = logs => {
  const map = {};
  for (let i = 29; i >= 0; i--) {
    const k = daysAgoISO(i);
    map[k] = 0;
  }
  logs.forEach(x => {
    if (x.date in map) {
      map[x.date] = roundHours(map[x.date] + Number(x.operatingHours || 0));
    }
  });
  return Object.entries(map).map(([date, hours]) => ({ date: date.slice(5), hours }));
};

export const monthlyByGenerator = (generators, logs) =>
  generators.map((g, i) => ({
    id: g.id,
    name: g.name,
    hours: totalHours(logs.filter(x => x.generatorId === g.id && x.date.startsWith(currentMonth()))),
    color: generatorColor(i),
  }));

// أحدث سجل للمولد مع استبعاد السجل الجاري تعديله، أي السجل الذي يجب أن يأتي السجل الجديد أو المعدّل بعده زمنيًا.
export const previousLog = (logs, generatorId, excludeId) =>
  generatorLogs(logs, generatorId).find(x => x.id !== excludeId) || null;

// قاعدة التاريخ لكل مولد: أول سجل يقبل اليوم أو تاريخًا سابقًا، وما بعده يبدأ من تاريخ أحدث سجل + يوم واحد ولا يتجاوز اليوم.
export const logDateRule = (logs, generatorId, excludeId) => {
  const max = todayISO();
  const prev = generatorId ? previousLog(logs, generatorId, excludeId) : null;
  const min = prev ? nextDay(prev.date) : '';
  const blocked = !!prev && min > max;
  return { prev, min, max, blocked, defaultDate: blocked ? '' : prev ? min : max };
};

// لوحة ألوان ثابتة متباينة تصلح للوضعين الفاتح والداكن، ويُحدد لون المولد بترتيبه الثابت في قائمة المولدات.
export const GENERATOR_COLORS = [
  '#0f766e',
  '#f59e0b',
  '#3b82f6',
  '#e11d48',
  '#8b5cf6',
  '#10b981',
  '#f97316',
  '#0ea5e9',
  '#db2777',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
];

export const generatorColor = index =>
  GENERATOR_COLORS[index] || `hsl(${Math.round((index * 137.508) % 360)}, 62%, 52%)`;
