export const normalizePhone = value => String(value ?? '').trim()
  .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0));

export function operatorErrors(payload = {}) {
  const errors = {};
  if (!String(payload.name || '').trim()) errors.name = 'اسم المشغل مطلوب';
  const phone = normalizePhone(payload.phone);
  const digits = phone.replace(/[\s().-]/g, '');
  if (phone && (!/^\+?[0-9\s().-]+$/.test(phone) || !/^\+?\d{7,15}$/.test(digits))) {
    errors.phone = 'أدخل رقم هاتف من 7 إلى 15 رقمًا؛ يمكن استخدام + ورمز الدولة، أو اتركه فارغًا';
  }
  return errors;
}
