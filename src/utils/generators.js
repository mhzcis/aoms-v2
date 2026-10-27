// قاعدة المولد الافتراضي (isDefault):
// 1. غياب الحقل في البيانات القديمة أو أي قيمة غير true تُعامل على أنها false.
// 2. المولد غير النشط لا يكون افتراضيًا أبدًا.
// 3. عند وجود أكثر من مولد نشط افتراضي، يُحتفظ بأول مولد بحسب ترتيبه في مصفوفة المولدات (ترتيب الإضافة)، وتُلغى الخاصية عن البقية.
export const normalizeDefaultGenerator = generators => {
 let found = false;
 return generators.map(g => {
  const isDefault = !found && g.isDefault === true && g.status === 'active';
  if (isDefault) found = true;
  return { ...g, isDefault };
 });
};
export const setDefaultGenerator = (generators, id) => generators.map(g => ({ ...g, isDefault: g.id === id && g.status === 'active' }));
export const defaultGenerator = generators => generators.find(g => g.isDefault === true && g.status === 'active') || null;
