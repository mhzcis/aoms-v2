# التقرير الأمني الشامل (Security Audit Report) — AOMS V2

## 1. فحص الأسرار والمفاتيح (`Secret Scanning / Gitleaks Equivalent`)
- تم فحص جميع الملفات النصية والبرمجية وملفات SQL وملفات الإعداد عبر `scripts/static-check.mjs`.
- **النتيجة:** `0` أسرار أو مفاتيح عالية الصلاحية أو رموز JWT مخزنة في الشيفرة المصدرية أو سجل Git.
- يقتصر ملف `.env.example` و`src/config.js` على متغيرين عامين فقط: `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY`.

## 2. تدقيق سياسات أمن الصفوف (`PostgreSQL RLS`) والإجراءات المخزنة (`SECURITY DEFINER RPCs`)
1. **إصلاح ثغرة انكشاف سجل التدقيق (`audit_logs`):**
   - **المشكلة المكتشفة في الحزمة الانتقالية:** كانت حلقة تفعيل RLS في `202610260001_aoms_v2.sql` تنشئ سياسة `read_active using (is_active_user())` على جميع الجداول بما فيها `audit_logs`، مما كان يسمح لدوري `Operator` و`Viewer` بقراءة سجل التدقيق الإداري خلافًا للقسم `16.3`.
   - **الإصلاح المنفذ:** تم فصل سياسة `audit_logs` لتكون `create policy read_admin_only on public.audit_logs for select to authenticated using (public.is_admin())`، مع منع أي صلاحية `INSERT/UPDATE/DELETE` مباشرة من العميل (`revoke all on public.audit_logs from anon, authenticated; grant select on public.audit_logs to authenticated;`).
2. **تثبيت `search_path = public` على جميع دوال `SECURITY DEFINER`:**
   - جميع الدوال الذرية (`current_profile`, `is_active_user`, `is_admin`, `can_operate`, `validate_and_save_dynamic_values`, `create_asset`, `update_asset`, `set_default_asset`, `save_operation_log`, `delete_operation_log`, `save_fuel_transaction`, `delete_fuel_transaction`, `save_chlorine_transaction`, `delete_chlorine_transaction`, `export_aoms_backup`, `restore_aoms_backup`) معرّفة بـ `set search_path = public` لمنع هجمات اختطاف مسار البحث (`Search Path Hijacking`).
3. **منع الحذف المادي (`Physical Deletion Prevention`):**
   - تم تفعيل Triggers على مستوى قاعدة البيانات (`trg_protect_categories`, `trg_protect_category_fields`, `trg_protect_field_options`, `trg_no_delete_assets`, `trg_no_delete_operators`, `trg_no_delete_fuel_types`) تمنع الحذف المادي حتى لو أُرسل طلب `DELETE` مباشر عبر واجهة REST API.

## 3. الحماية من ثغرات حقن الواجهة والتقارير والملفات
- **حماية `DOM XSS` في تقارير الطباعة وPDF:** جميع القيم النصية وعناوين الأعمدة والفلاتر تمر عبر `escapeHtml()` في `src/services/reportService.js` و`src/services/aomsReportService.js`.
- **حماية `CSV Formula Injection (CWE-1236)`:** جميع الخلايا المصدرة إلى CSV تمر عبر `sanitizeCsvCell()` التي تسبق أي نص يبدأ بـ `=`, `+`, `-`, `@`, `\t`, `\r` بعلامة اقتباس مفردة `'`.
- **حماية `Prototype Pollution` وتحديد حجم ملفات JSON:**
  - يفرض `validateAndPreviewBackup` حدًا أقصى لحجم ملف النسخة الاحتياطية (`25 MB`، `BACKUP_MAX_BYTES`؛ تحقق على العميل فقط).
  - تُصفّى جميع الكائنات المستوردة عبر `sanitizeNoProto` لاستبعاد المفاتيح `__proto__` و`constructor` و`prototype`.
  - يرفض الفاحص أي ملف نسخة احتياطية يحتوي على حقول كلمات مرور أو رموز جلسات (`password`, `encrypted_password`, `access_token`, `refresh_token`).
