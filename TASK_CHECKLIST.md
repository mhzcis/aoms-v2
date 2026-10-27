# قائمة التحقق التنفيذية الشاملة (AOMS V2 Master Task Checklist)

- [x] **1. التدقيق المعماري وفحص الفجوات (Gap Analysis)**
  - [x] مراجعة ملف المواصفات الكامل `AOMS_V2_FINAL_MASTER_SPECIFICATION_FULL.md` (الأقسام 1 إلى 23 + الملاحق A وB وC).
  - [x] مراجعة تعليمات الوكيل التنفيذي `EXECUTIVE_AGENT_COMPLETION_INSTRUCTIONS.md`.
  - [x] إصلاح خطأ المحارف التالفة في `scripts/static-check.mjs` وتوسيعه ليشمل فحص بنية جميع ملفات `.js` و`.jsx` و`.mjs`.

- [x] **2. طبقة قاعدة البيانات والمعاملات الذرية (Supabase SQL Migrations & RPCs)**
  - [x] استكمال جميع الجداول الـ 15 والفهارس والقيود في `supabase/migrations/202610260001_aoms_v2.sql`.
  - [x] تطبيق سياسات أمن الصفوف `RLS` الصارمة للأدوار الثلاثة (`admin`, `operator`, `viewer`) ومنع الحسابات المعطلة (`status = 'active'`) وحصر جدول `audit_logs` بمدير النظام.
  - [x] بناء الدوال التبادلية الذرية (Transactional RPCs) في `supabase/migrations/202610260002_transactions_backup.sql`:
    - `create_asset` / `update_asset` / `set_default_asset`
    - `save_operation_log` / `delete_operation_log`
    - `save_fuel_transaction` / `delete_fuel_transaction`
    - `save_chlorine_transaction` / `delete_chlorine_transaction`
    - `export_aoms_backup` / `restore_aoms_backup`

- [x] **3. طبقة النطاق والمحرك التبادلي (`src/domain/models.js` & `src/domain/aomsEngine.js`)**
  - [x] تطبيق دوال التحقق الصارمة للتصنيفات والحقول الديناميكية والوراثة/التجاوز (بما فيها قبول الصفر `0` كتجاوز صريح).
  - [x] تطبيق قواعد تسلسل القراءات والتواريخ ومنع التعديل/الحذف إلا لآخر سجل لكل أصل أو نوع وقود أو كلور.
  - [x] تطبيق القفل التفاؤلي (`version`) ومنع الأرصدة السالبة للوقود والكلور.
  - [x] تطبيق محرك البحث العالمي `globalSearchState` ومحرك التقارير `buildAomsReport` مع فصل مجاميع الوحدات غير المتجانسة.
  - [x] تطبيق التحقق المسبق والاستعادة الذرية للنسخ الاحتياطية `validateAndPreviewBackup` بحد أقصى `25MB`.

- [x] **4. طبقة المستودع والخدمات والتصدير (`src/repositories/supabaseRepository.js`, `src/services/aomsService.js`, `src/services/aomsReportService.js`)**
  - [x] ربط `SupabaseRepository` بجميع الدوال التبادلية (RPCs) مع ذاكرة قراءة مؤقتة للوضع غير المتصل.
  - [x] فرض وضع القراءة فقط عند انقطاع الاتصال (`Offline Read-Only`) دون أي طابور كتابة محلي.
  - [x] بناء خدمة تصدير التقارير الاحترافية `aomsReportService.js` بصيغ `Excel (.xlsx)` و`PDF` (بخط Amiri العربي يُحمَّل وقت التشغيل من `public/fonts` — أُصلح في تدقيق 2026-10-27؛ كان الادعاء السابق غير صحيح) و`CSV (UTF-8 BOM)`.

- [x] **5. طبقة الواجهات وتجربة المستخدم (`src/pages/*`, `src/components/AppShell.jsx`, `src/context/AomsContext.jsx`)**
  - [x] استكمال شاشة تسجيل الدخول واستعادة كلمة المرور `src/pages/Login.jsx`.
  - [x] استكمال لوحة التحكم التنفيذية `src/pages/AomsDashboard.jsx` (KPIs، تنبيهات انخفاض الوقود والكلور، الرسوم البيانية، آخر الأحداث).
  - [x] استكمال جميع الشاشات الـ 11 في `src/pages/EntityPage.jsx`.
  - [x] تحديث `src/components/AppShell.jsx` لدعم كلٍّ من `AomsContext` و`AppContext` لضمان نجاح جميع اختبارات الواجهة `src/test/ui.test.jsx`.

- [x] **6. الفحص والتدقيق والتوثيق النهائي**
  - [x] كتابة وتشغيل `scripts/verify-acceptance.mjs` (56 تأكيدًا على النموذج المرجعي؛ تغطية الـ 144 معيارًا في ACCEPTANCE_COVERAGE.md).
  - [x] إعداد `TRACEABILITY_MATRIX.md` و`SECURITY_AUDIT_REPORT.md` و`ADVERSARIAL_REVIEW_REPORT.md` و`IMPLEMENTATION_REPORT.md` و`code-diff.patch`.
