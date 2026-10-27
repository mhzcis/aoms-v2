import { addDays, format, isValid, parseISO, subDays } from 'date-fns';
import { ar } from 'date-fns/locale';

export const todayISO = () => format(new Date(), 'yyyy-MM-dd');
export const daysAgoISO = days => format(subDays(new Date(), days), 'yyyy-MM-dd');
export const dayName = date => (date ? format(parseISO(date), 'EEEE', { locale: ar }) : '');
export const niceDate = date => (date ? format(parseISO(date), 'dd/MM/yyyy') : '—');
export const stamp = () => format(new Date(), 'yyyy-MM-dd-HH-mm-ss');
export const isoNow = () => new Date().toISOString();
export const currentMonth = () => format(new Date(), 'yyyy-MM');
export const nextDay = date => format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
export const isValidISODate = date =>
  typeof date === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  isValid(parseISO(date)) &&
  format(parseISO(date), 'yyyy-MM-dd') === date;
export const todayArabic = () => format(new Date(), 'EEEE dd/MM/yyyy', { locale: ar });
