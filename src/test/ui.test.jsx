import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { AppProvider, useApp } from '../context/AppContext';
import { makeTheme } from '../theme';
import OperationLogs, { paginationAriaLabel } from '../pages/OperationLogs';
import Generators from '../pages/Generators';
import AppShell from '../components/AppShell';
import LogForm from '../components/LogForm';
import { gen, log, memoryStorage } from './fixtures';

const seed = data => {
  globalThis.localStorage = memoryStorage();
  if (data === null) return;
  localStorage.setItem(
    'generator-tracker-v1',
    JSON.stringify({ version: '1.0', meta: {}, ...data })
  );
};
const data = () => ({
  generators: [
    gen('a', { isDefault: true, latitude: '31.3461', longitude: '34.3064' }),
    gen('b'),
    gen('c', { status: 'inactive' }),
  ],
  logs: [
    log('1', 'a', '2026-10-15', {
      previousReading: 0,
      currentReading: 50,
      operatingHours: 50,
    }),
  ],
});
const renderAt = url =>
  renderToString(
    <ThemeProvider theme={makeTheme('light')}>
      <AppProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/logs" element={<OperationLogs />} />
            <Route path="/generators" element={<Generators />} />
          </Routes>
        </MemoryRouter>
      </AppProvider>
    </ThemeProvider>
  );
const grabApp = () => {
  let api;
  const Grab = () => {
    api = useApp();
    return null;
  };
  renderToString(
    <AppProvider>
      <Grab />
    </AppProvider>
  );
  return api;
};
const formSelectValue = html =>
  [...html.matchAll(/class="MuiSelect-nativeInput[^"]*" value="([^"]*)"/g)].map(m => m[1]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 19, 12));
});
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.localStorage;
});

describe('واجهة سجل التشغيل والمولدات', () => {
  it('نموذج سجل جديد يختار المولد الافتراضي ويحسب التاريخ والقراءة السابقة من آخر سجل له', () => {
    seed(data());
    const html = renderAt('/logs');
    expect(formSelectValue(html)[0]).toBe('a');
    expect(html).toContain('value="2026-10-16"');
    expect(html).toContain('min="2026-10-16"');
    expect(html).toContain('value="50"');
  });

  it('الانتقال من مولد بلا سجلات يفتح النموذج ويختار المولد بتاريخ اليوم وقراءة سابقة يدوية', () => {
    seed(data());
    const html = renderAt('/logs?generator=b&new=1');
    expect(html).toContain('MuiCollapse-entered');
    expect(formSelectValue(html)[0]).toBe('b');
    expect(html).toContain('value="2026-10-19"');
    expect(html).toContain('أدخل قراءة البداية لأول سجل');
  });

  it('يعطل الحفظ ويعرض رسالة عربية إذا كان أحدث سجل للمولد الافتراضي بتاريخ اليوم', () => {
    seed({ generators: [gen('a', { isDefault: true })], logs: [log('1', 'a', '2026-10-19')] });
    const html = renderAt('/logs');
    expect(html).toContain('لا يمكن إضافة سجل آخر له قبل اليوم التالي');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>حفظ السجل/);
  });

  it('بيانات localStorage القديمة بلا isDefault تعمل دون خطأ ولا يُختار أي مولد افتراضيًا', () => {
    seed({ generators: [gen('a'), gen('b')], logs: [] });
    expect(formSelectValue(renderAt('/logs'))[0]).toBe('');
  });

  it('بطاقة المولد تعرض إحداثيات العرض والطول عند توفرها', () => {
    seed(data());
    const html = renderAt('/generators');
    expect(html).toContain('31.3461, 34.3064');
  });
});

describe('طبقة الخدمة تمنع التحايل على الواجهة', () => {
  it('ترفض تاريخًا سابقًا لأحدث سجل حتى لو أُرسل مباشرة', () => {
    seed(data());
    const r = grabApp().saveLog({
      generatorId: 'a',
      date: '2026-10-10',
      recordType: 'daily',
      previousReading: '50',
      currentReading: '60',
      notes: '',
    });
    expect(r.date).toContain('بعد 15/10/2026');
  });

  it('تفرض القراءة السابقة من أحدث سجل وتتجاهل القيمة المرسلة يدويًا', () => {
    seed(data());
    const r = grabApp().saveLog({
      generatorId: 'a',
      date: '2026-10-16',
      recordType: 'daily',
      previousReading: '0',
      currentReading: '20',
      notes: '',
    });
    expect(r.currentReading).toBe('القراءة الحالية لا تقل عن السابقة في السجل اليومي');
  });

  it('ترفض تعديل سجل غير الأخير', () => {
    seed({ generators: [gen('a')], logs: [log('1', 'a', '2026-10-10'), log('2', 'a', '2026-10-12')] });
    expect(grabApp().saveLog({ ...log('1', 'a', '2026-10-10') }).general).toBe(
      'لا يمكن تعديل سوى آخر سجل للمولد'
    );
  });

  it('ترفض تعيين مولد غير نشط افتراضيًا', () => {
    seed(data());
    expect(grabApp().makeDefault('c')).toBe(false);
  });
});

describe('القائمة الجانبية وترتيب النموذج', () => {
  it('حقل المولد يسبق حقل التاريخ في نموذج السجل الجديد', () => {
    seed(data());
    const html = renderAt('/logs');
    const form = html.slice(html.indexOf('إضافة سجل تشغيل'));
    expect(form.indexOf('>المولد<')).toBeGreaterThan(-1);
    expect(form.indexOf('>المولد<')).toBeLessThan(form.indexOf('>التاريخ<'));
  });

  it('القائمة تعرض زر «مسح شامل» بلون الخطر أسفل «نسخة احتياطية» ثم نص الحقوق المنسق مع ♥️', () => {
    seed(data());
    const html = renderToString(
      <ThemeProvider theme={makeTheme('light')}>
        <AppProvider>
          <MemoryRouter>
            <Routes>
              <Route element={<AppShell mode="light" setMode={() => {}} />}>
                <Route index element={null} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AppProvider>
      </ThemeProvider>
    );
    const backupAt = html.indexOf('نسخة احتياطية</button>');
    const wipeAt = html.indexOf('مسح شامل</button>');
    expect(backupAt).toBeGreaterThan(-1);
    expect(wipeAt).toBeGreaterThan(backupAt);
    expect(html.slice(html.lastIndexOf('<button', wipeAt), wipeAt)).toContain('MuiButton-colorError');
    const credit = html.slice(wipeAt).replace(/<style[^>]*>.*?<\/style>/g, '');
    expect(credit).toMatch(/<div[^>]*>برمجة وتطوير:<\/div><div[^>]*>م\. محمد أبو زهري<\/div>/);
    expect(credit).toContain('♥️');
  });
});

describe('الإصلاحات: الترقيم العربي، ربط ملف النسخة، البيانات التالفة', () => {
  const shell = () =>
    renderToString(
      <ThemeProvider theme={makeTheme('light')}>
        <AppProvider>
          <MemoryRouter>
            <Routes>
              <Route element={<AppShell mode="light" setMode={() => {}} />}>
                <Route index element={null} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AppProvider>
      </ThemeProvider>
    );

  it('أزرار الترقيم بتسميات وتلميحات عربية', () => {
    const logs = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(2026, 8, 1 + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return log(`l${i}`, 'a', iso, { previousReading: i, currentReading: i + 1, operatingHours: 1 });
    });
    seed({ generators: [gen('a', { isDefault: true })], logs });
    const html = renderAt('/logs');
    expect(html).toContain('aria-label="الصفحة التالية"');
    expect(html).toContain('title="الصفحة السابقة"');
    expect(html).toContain('عدد السجلات في الصفحة:');
    expect(html).toContain('1–25 من 30');
    expect(html).not.toContain('Go to next page');
    expect(['first', 'last', 'next', 'previous'].map(paginationAriaLabel)).toEqual([
      'الصفحة الأولى',
      'الصفحة الأخيرة',
      'الصفحة التالية',
      'الصفحة السابقة',
    ]);
  });

  it('المتصفح غير الداعم: تظهر رسالة توضيحية بدل زر ربط الملف', () => {
    seed(data());
    const html = shell();
    expect(html).toContain('غير مدعوم في هذا المتصفح');
    expect(html).not.toContain('ربط ملف نسخة احتياطية</button>');
  });

  it('المتصفح الداعم: يظهر زر «ربط ملف نسخة احتياطية» بعد زري النسخة والمسح', () => {
    seed(data());
    globalThis.window = { showSaveFilePicker: async () => null };
    try {
      const html = shell();
      const linkAt = html.indexOf('ربط ملف نسخة احتياطية</button>');
      expect(linkAt).toBeGreaterThan(html.indexOf('مسح شامل</button>'));
    } finally {
      delete globalThis.window;
    }
  });

  it('بيانات تالفة: السياق يعرض حالة التلف ولا يقرأها كبيانات، والقيمة الأصلية باقية', () => {
    seed(null);
    localStorage.setItem('generator-tracker-v1', '{broken');
    const api = grabApp();
    expect(api.corrupt.raw).toBe('{broken');
    expect(api.corrupt.key).toMatch(/^generator-tracker-v1-corrupt-2026-10-19-12-00-00$/);
    expect(api.data.generators).toEqual([]);
    expect(localStorage.getItem('generator-tracker-v1')).toBe('{broken');
    expect(typeof api.startFresh).toBe('function');
    expect(typeof api.downloadCorrupt).toBe('function');
  });
});

describe('التعديلات الثالثة: الحالة، الفلاتر، الترتيب، الملف المرتبط', () => {
  it('حالة السجل «أصلي» و«معدّل» تظهران كشارتين بالنمط نفسه', () => {
    seed({
      generators: [gen('a', { isDefault: true })],
      logs: [
        log('1', 'a', '2026-10-15', { currentReading: 5, operatingHours: 5 }),
        log('2', 'a', '2026-10-16', { previousReading: 5, currentReading: 9, operatingHours: 4, edited: true }),
      ],
    });
    const html = renderAt('/logs');
    expect(html).toMatch(/MuiChip-root[^>]*>(<[^>]+>)*<span class="MuiChip-label[^"]*">أصلي<\/span>/);
    expect(html).toMatch(/MuiChip-root[^>]*>(<[^>]+>)*<span class="MuiChip-label[^"]*">معدّل<\/span>/);
    expect(html).not.toMatch(/<td[^>]*>أصلي<\/td>/);
  });

  it('لوحة الفلاتر مخفية افتراضيًا عند فتح صفحة السجلات، وزر الإظهار موجود', () => {
    seed(data());
    const html = renderAt('/logs');
    expect(html).toContain('إظهار الفلاتر');
    expect(html).not.toContain('إخفاء الفلاتر');
    const clean = html.replace(/<style[^>]*>.*?<\/style>/g, '');
    const searchAt = clean.indexOf('بحث شامل');
    const roots = clean.slice(0, searchAt).match(/class="MuiCollapse-root[^"]*"/g);
    expect(roots.at(-1)).toContain('MuiCollapse-hidden');
  });

  it('أثناء ربط ملف: يُحدَّث الملف بدل تنزيل ملف منفصل، وتعود التنزيلات بعد إلغاء الربط أو فشل الكتابة', async () => {
    const bs = await import('../services/backupService');
    const writes = [];
    let fail = false;
    globalThis.window = {
      showSaveFilePicker: async () => ({
        name: 'linked.json',
        createWritable: async () => {
          if (fail) throw new Error('lost');
          return { write: async t => writes.push(t), close: async () => {} };
        },
      }),
    };
    const created = vi.fn(() => 'blob:x');
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = created;
    try {
      seed(data());
      await bs.linkBackupFile();
      let api = grabApp();
      api.addGenerator({ number: 'N1', name: 'جديد', location: 'م', capacity: '', status: 'active' });
      await vi.runAllTimersAsync();
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]).generators.some(g => g.number === 'N1')).toBe(true);
      expect(created).not.toHaveBeenCalled();
      // فشل الكتابة (فقدان الربط): يُلغى الربط ويعود التنزيل
      fail = true;
      api = grabApp();
      api.addGenerator({ number: 'N2', name: 'جديد 2', location: 'م', capacity: '', status: 'active' });
      await vi.runAllTimersAsync();
      expect(bs.hasLinkedBackupFile()).toBe(false);
      expect(created).toHaveBeenCalledTimes(1);
      // بعد إلغاء الربط: تنزيل تلقائي عادي
      api = grabApp();
      api.addGenerator({ number: 'N3', name: 'جديد 3', location: 'م', capacity: '', status: 'active' });
      expect(created).toHaveBeenCalledTimes(2);
    } finally {
      bs.unlinkBackupFile();
      URL.createObjectURL = origCreate;
      delete globalThis.window;
    }
  });
});

describe('تغيير العداد: حقل القراءة السابقة', () => {
  const renderForm = edit =>
    renderToString(
      <ThemeProvider theme={makeTheme('light')}>
        <AppProvider>
          <LogForm open edit={edit} onDone={() => {}} />
        </AppProvider>
      </ThemeProvider>
    );
  const prevInput = html => {
    const clean = html.replace(/<style[^>]*>.*?<\/style>/g, '');
    const at = clean.indexOf('>القراءة السابقة<');
    return clean.slice(at, clean.indexOf('/>', clean.indexOf('<input', at)));
  };
  const logs = [
    log('1', 'a', '2026-10-15', { previousReading: 100, currentReading: 110, operatingHours: 10 }),
    log('2', 'a', '2026-10-16', { recordType: 'meterReset', previousReading: 15749, currentReading: 15754, operatingHours: 5 }),
  ];

  it('تعديل آخر سجل من نوع تغيير عداد: الحقل مفتوح للإدخال ويحمل قراءة بداية العداد الجديد', () => {
    seed({ generators: [gen('a', { isDefault: true })], logs });
    const input = prevInput(renderForm(logs[1]));
    expect(input).toContain('value="15749"');
    expect(input).not.toContain('disabled');
    expect(renderForm(logs[1])).toContain('أدخل قراءة بداية العداد الجديد');
  });

  it('سجل يومي جديد بعد سجلات سابقة: الحقل مقفل ويُجلب من آخر قراءة', () => {
    seed({ generators: [gen('a', { isDefault: true })], logs });
    const input = prevInput(renderForm(null));
    expect(input).toContain('value="15754"');
    expect(input).toContain('disabled');
  });
});
