import { describe, expect, it } from 'vitest';
import { defaultGenerator, normalizeDefaultGenerator, setDefaultGenerator } from './generators';
import { validateGenerator } from './validators';
import { gen } from '../test/fixtures';

describe('المولدات والمولد الافتراضي', () => {
 it('يرفض رقم مولد مكرر مع تجاهل حالة الأحرف والمسافات الطرفية', () => {
  expect(validateGenerator({ id: '2', number: ' g-1 ', name: 'ب', location: 'م', capacity: '' }, [gen('1')]).number).toBe('رقم المولد مستخدم مسبقًا');
 });
 it('يعيّن مولدًا افتراضيًا واحدًا', () => {
  const list = setDefaultGenerator([gen('1'), gen('2')], '2');
  expect(list.map(g => g.isDefault)).toEqual([false, true]);
  expect(defaultGenerator(list).id).toBe('2');
 });
 it('يلغي الافتراضي السابق عند تعيين مولد آخر', () => {
  const list = setDefaultGenerator(setDefaultGenerator([gen('1'), gen('2'), gen('3')], '1'), '3');
  expect(list.filter(g => g.isDefault).map(g => g.id)).toEqual(['3']);
 });
 it('يرفض تعيين مولد غير نشط افتراضيًا', () => {
  const list = setDefaultGenerator([gen('1', { isDefault: true }), gen('2', { status: 'inactive' })], '2');
  expect(list.some(g => g.isDefault)).toBe(false);
  expect(defaultGenerator(list)).toBeNull();
 });
 it('يلغي افتراضية المولد عند تحويله إلى غير نشط', () => {
  const list = normalizeDefaultGenerator([gen('1', { isDefault: true, status: 'inactive' }), gen('2')]);
  expect(list.map(g => g.isDefault)).toEqual([false, false]);
 });
 it('يتوافق مع بيانات قديمة بلا isDefault ويعتبرها false دون حذف أي حقل', () => {
  const old = [gen('1'), gen('2')];
  const list = normalizeDefaultGenerator(old);
  expect(list.map(g => g.isDefault)).toEqual([false, false]);
  expect(list[0]).toEqual({ ...old[0], isDefault: false });
  expect(defaultGenerator(old)).toBeNull();
 });
 it('يسوّي أكثر من مولد افتراضي بقاعدة حتمية: أول مولد نشط بحسب ترتيب المصفوفة', () => {
  const list = normalizeDefaultGenerator([gen('1', { isDefault: true, status: 'inactive' }), gen('2', { isDefault: true }), gen('3', { isDefault: true })]);
  expect(list.map(g => g.isDefault)).toEqual([false, true, false]);
  expect(normalizeDefaultGenerator(list)).toEqual(list);
 });
 it('لا يعتبر قيمة غير منطقية مثل "true" افتراضية', () => {
  expect(normalizeDefaultGenerator([gen('1', { isDefault: 'true' })])[0].isDefault).toBe(false);
 });
});
