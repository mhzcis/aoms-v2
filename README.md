# AOMS V2 — نظام إدارة وتشغيل الأصول والمعدات

تطوير تطوري شامل لنسخة Generator Operation Tracker إلى نظام عام لإدارة وتشغيل الأصول والمعدات (**Asset Operations Management System — AOMS V2**)، باستخدام React 19 وVite وMaterial UI وSupabase/PostgreSQL. يبدأ AOMS ببيانات تشغيلية فارغة ولا يستورد `localStorage` القديم تلقائيًا.

## المتطلبات
- Node.js 20+ / 22
- مشروع Supabase (PostgreSQL + Auth + RLS + Realtime)
- GitHub Pages أو خادم ملفات ثابت

## إعداد قاعدة البيانات (Supabase)
1. أنشئ مشروع Supabase جديدًا، ومن إعدادات `Authentication > Providers > Email` أوقف التسجيل العام (`Allow new users to sign up = OFF`) ليبقى إنشاء ودعوة المستخدمين حصريًا لمدير النظام.
2. من `SQL Editor` نفّذ ملفات الترحيل بالترتيب:
   - `supabase/migrations/202610260001_aoms_v2.sql`
   - `supabase/migrations/202610260002_transactions_backup.sql`
   - `supabase/migrations/202610260003_audit_hardening.sql` (أُضيف في تدقيق 2026-10-27: إنشاء الملف الشخصي تلقائيًا، تثبيت `search_path`، حماية الأرصدة من السباق، إقفال الحقول، ذرية الاستعادة، النشر في `supabase_realtime` وغيرها)
   - `supabase/migrations/202610270004_field_select_options.sql` (الجولة 3: فرض FIELD-003 في قاعدة البيانات — حقل قائمة منسدلة نشط يجب أن يملك خيارًا نشطًا، ودالة `save_category_field` لحفظ الحقل وخياراته ذريًا)
3. أنشئ أول مستخدم من لوحة `Authentication > Users`، ثم أضف ملفه الشخصي كمدير للنظام:
   ينشئ المُشغِّل `on_auth_user_created_aoms` (الترحيل 003) ملفًا شخصيًا تلقائيًا بدور `viewer` وحالة `inactive`، لذا فعّل المدير الأول بتحديث الملف لا بإدراجه:
```sql
update public.profiles set full_name = 'مدير النظام', role = 'admin', status = 'active'
where id = 'AUTH_USER_UUID';
```
   المستخدمون اللاحقون: ادعُهم من لوحة Supabase (`Invite user`) أولًا، ثم عدّل دورهم وحالتهم من شاشة المستخدمين؛ لا يمكن للواجهة إنشاء ملف شخصي دون مستخدم Auth.
4. فعّل `Realtime` للجداول التشغيلية من لوحة `Database > Publications` (`supabase_realtime`).
5. لا تضع أي مفتاح خدمة مرتفع الصلاحية في المشروع أو في GitHub. يستخدم العميل المفتاح العام (`VITE_SUPABASE_ANON_KEY`) فقط، وتُفرض الحماية الفعلية عبر سياسات `RLS` والدوال الذرية (`SECURITY DEFINER RPCs`).

## التشغيل المحلي والفحص الشامل
```bash
cp .env.example .env.local
npm install
npm run check
npm run dev
```

- ينفذ `npm run lint` كلاً من الفحص الثابت وفحص الأسرار (`scripts/static-check.mjs`) ومجموعة تأكيدات النموذج المرجعي (56 تأكيدًا) (`scripts/verify-acceptance.mjs`).
- ينفذ `npm run test` اختبارات الوحدة عبر `Vitest`.
- ينفذ `npm run build` بناء نسخة الإنتاج الجاهزة للنشر.
- ملاحظة: `npm run lint` ليس ESLint؛ هو فحص ثابت مخصص (`scripts/static-check.mjs`) يليه `verify-acceptance.mjs` الذي يعمل على النموذج المرجعي في الذاكرة لا على Supabase.
- `npm run test:db`: اختبارات قاعدة بيانات حقيقية (65 فحصًا: RLS، الصلاحيات، السباق المتوازي، الأرصدة، ذرية الاستعادة) على PostgreSQL 17 محلي مع طبقة محاكاة لـ Supabase (`supabase/tests/00_supabase_stub.sql`). يتطلب `PGHOST/PGPORT/PGUSER` لخادم PostgreSQL متاح.
- `e2e/run-e2e.sh`: اختبارات متصفح Playwright على النسخة المبنية مع PostgREST حقيقي وقاعدة بيانات مزروعة (`e2e/seed.mjs`)؛ طبقتا Auth وRealtime فيها محاكاة. راجع رأس `e2e/run-e2e.mjs` للمتطلبات.
- مصفوفة التغطية الفعلية لمعايير القبول الـ 144: `ACCEPTANCE_COVERAGE.md`.

## النشر على GitHub Pages
1. أضف السرّين `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` في `Settings > Secrets and variables > Actions`.
2. من `Settings > Pages` اختر المصدر `GitHub Actions`.
3. عند الدفع إلى فرع `main`، يعمل سير العمل `.github/workflows/deploy.yml` تلقائيًا لتشغيل الاختبارات والبناء والنشر.

## الوثائق والتقارير المرفقة في المستودع
- `TRACEABILITY_MATRIX.md`: مصفوفة التتبع (تغطي جزءًا من البنود؛ التغطية الفعلية للـ 144 معيارًا في ACCEPTANCE_COVERAGE.md).
- `SECURITY_AUDIT_REPORT.md`: تقرير الفحص الأمني وتدقيق سياسات RLS والـ RPCs.
- `ADVERSARIAL_REVIEW_REPORT.md`: تقرير المراجعات الثلاث واختبارات السباق والكسر.
- `IMPLEMENTATION_REPORT.md`: تقرير التنفيذ ونتائج الفحص القبلي والبعدي والمانع البيئي الخارجي وخطوات إغلاقه.
- `DECISIONS.md`: سجل القرارات المعمارية المعتمدة.
