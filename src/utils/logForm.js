import { logDateRule } from './calculations';
import { defaultGenerator } from './generators';
// يضبط المولد في نموذج سجل جديد ويعيد حساب التاريخ الافتراضي والقراءة السابقة من أحدث سجل لذلك المولد.
export const applyGenerator = (form, logs, generatorId) => {
 const rule = logDateRule(logs, generatorId);
 return { ...form, generatorId, date: rule.defaultDate, previousReading: rule.prev ? String(rule.prev.currentReading) : '' };
};
// نموذج سجل جديد: المولد المطلوب إن كان نشطًا، وإلا المولد الافتراضي النشط، وإلا بلا مولد.
export const newLogForm = (generators, logs, preferredId) => {
 const generatorId = (generators.find(g => g.id === preferredId && g.status === 'active') || defaultGenerator(generators))?.id || '';
 return applyGenerator({ recordType: 'daily', currentReading: '', notes: '' }, logs, generatorId);
};
// نموذج تعديل آخر سجل: القراءة السابقة تُجلب من السجل السابق له إن وجد.
// سجل تغيير العداد يحتفظ بقراءة بداية العداد الجديد كما أُدخلت.
export const editLogForm = (edit, logs) => {
 const rule = logDateRule(logs, edit.generatorId, edit.id);
 return rule.prev && edit.recordType !== 'meterReset' ? { ...edit, previousReading: String(rule.prev.currentReading) } : edit;
};
// رابط مولد بلا سجلات في لوحة التحكم: يفتح نموذج سجل جديد للمولد النشط، ويبقى الانتقال كما هو للمولد غير النشط لأنه لا يظهر في قائمة الإدخال.
export const noLogsLink = g => `/logs?generator=${g.id}${g.status === 'active' ? '&new=1' : ''}`;
