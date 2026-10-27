# مصفوفة التتبع الشاملة (Traceability Matrix) — AOMS V2

توثق هذه المصفوفة متطلبات واختبارات القبول (القسم 22 يحتوي **144** معيارًا وهذه المصفوفة تذكر جزءًا منها فقط؛ الحالة الفعلية لكل معيار في ACCEPTANCE_COVERAGE.md) الواردة في `AOMS_V2_FINAL_MASTER_SPECIFICATION_FULL.md` (القسم 22)، وحالتها في الحزمة الانتقالية السابقة، والإصلاح الفعلي المنفذ، وملفات التنفيذ، ونتيجة الاختبار الآلي.

## 1. التصنيفات (`CAT-001` إلى `CAT-012`)

| المعرّف | المطلب / معيار القبول | الفجوة في الحزمة الانتقالية | الإصلاح المنفذ وملفات التنفيذ | الاختبار والنتيجة الفعلية |
| :--- | :--- | :--- | :--- | :--- |
| **CAT-001** | إنشاء تصنيف نشط باسم واختصار فريد ينجح | لم تكن هناك واجهة أو خدمة لإضافة التصنيفات | `aomsEngine.js` (`saveCategory`)، `aomsService.js`، `EntityPage.jsx`، `202610260001_aoms_v2.sql` | `verify-acceptance.mjs` (`CAT-001`) — **PASS** |
| **CAT-002** | رفض الاسم الفارغ | غياب التحقق في الواجهة والخدمة | `models.js` (`validateCategoryInput`)، `202610260001_aoms_v2.sql` (`check`) | `verify-acceptance.mjs` (`CAT-002`) — **PASS** |
| **CAT-003** | رفض اختصار مكرر ولو اختلفت حالة الأحرف أو المسافات | لم يكن التطبيع مطبقًا عند التحديث | `models.js` (`normalizePrefix`)، `trg_protect_categories_fn` | `verify-acceptance.mjs` (`CAT-003`) — **PASS** |
| **CAT-004** | رفض وحدة عداد عند `uses_meter=false` أو تنظيفها آمنًا | لم يكن هناك تنظيف تلقائي في SQL/JS | `models.js`، `aomsEngine.js`، `trg_protect_categories_fn` (`meter_unit := null`) | `verify-acceptance.mjs` (`CAT-004`) — **PASS** |
| **CAT-005** | إلزام وحدة العداد من القائمة الخمسية عند `uses_meter=true` | لم يكن هناك قيد على القائمة المعتمدة | `models.js` (`METER_UNITS`)، `202610260001_aoms_v2.sql` (`check`) | `verify-acceptance.mjs` (`CAT-005`) — **PASS** |
| **CAT-006** | تعطيل التصنيف يمنع إنشاء أصل تحته | كان يتحقق جزئيًا دون واجهة | `aomsEngine.js` (`createAsset`)، `create_asset` RPC | `verify-acceptance.mjs` (`CAT-006`) — **PASS** |
| **CAT-007** | إعادة التفعيل تعيد إمكانية الإنشاء | غياب زر/نموذج إعادة التفعيل | `EntityPage.jsx`، `aomsEngine.js` (`saveCategory`) | `verify-acceptance.mjs` (`CAT-007`) — **PASS** |
| **CAT-008** | منع حذف التصنيف ماديًا | كان الحذف المباشر ممكنًا لصلاحية المدير في SQL | `trg_protect_categories_fn` (`BEFORE DELETE RAISE EXCEPTION`)، `aomsEngine.js` | `verify-acceptance.mjs` (`CAT-008`) — **PASS** |
| **CAT-009** | منع تغيير الاختصار بعد وجود أصول | لم يكن هناك قيد يمنع تعديل `code_prefix` بعد إنشاء أصل | `trg_protect_categories_fn`، `validateCategoryInput` (`models.js`) | `verify-acceptance.mjs` (`CAT-009`) — **PASS** |
| **CAT-010** | استمرار تسلسل الكود بعد التعطيل وإعادة التفعيل | لم يكن مختبرًا | `categories.next_asset_sequence` محفوظ ومستمر في SQL و`aomsEngine.js` | `verify-acceptance.mjs` (`CAT-010`) — **PASS** |
| **CAT-011** | تصنيف يستخدم عدادًا دون وقود يعمل طبيعيًا | لم يكن مفصولًا في الواجهة | `save_operation_log` RPC، `aomsEngine.js`، `EntityPage.jsx` | `verify-acceptance.mjs` (`CAT-011`) — **PASS** |
| **CAT-012** | تصنيف لا يستخدم عدادًا يعرض سجلًا بلا قراءات | كانت الأعمدة ثابتة في `EntityPage.jsx` | إخفاء حقول العداد وتصفيرها إلى `null` في `EntityPage.jsx` و`save_operation_log` | `verify-acceptance.mjs` (`CAT-012`) — **PASS** |

## 2. الحقول الديناميكية (`FIELD-001` إلى `FIELD-012`)

| المعرّف | المطلب / معيار القبول | الفجوة في الحزمة الانتقالية | الإصلاح المنفذ وملفات التنفيذ | الاختبار والنتيجة الفعلية |
| :--- | :--- | :--- | :--- | :--- |
| **FIELD-001** | إنشاء كل نوع من الأنواع الخمسة (`text`, `number`, `select`, `date`, `boolean`) | لم تكن هناك واجهة أو خدمة لإنشاء الحقول وخياراتها | `aomsEngine.js` (`saveCategoryField`)، `EntityPage.jsx` (`DynamicFieldInput`) | `verify-acceptance.mjs` (`FIELD-001`) — **PASS** |
| **FIELD-002** | تنفيذ التحقق الصحيح لكل نوع في الواجهة والخدمة وقاعدة البيانات | لم يكن هناك تحقق في قاعدة البيانات (`RPC`) | `validate_and_save_dynamic_values` في SQL، `validateDynamicValue` في `models.js` | `verify-acceptance.mjs` (`FIELD-002`) — **PASS** |
| **FIELD-003** | رفض قائمة منسدلة بلا خيارات نشطة | لم يكن مفحوصًا | `validateDynamicFieldDef` (`models.js`)، `aomsEngine.js` | `verify-acceptance.mjs` (`FIELD-003`) — **PASS** |
| **FIELD-004** | ترتيب الحقول (`sort_order`) ينعكس في نماذج الأصل والتشغيل | لم تكن الحقول تعرض في النماذج | `EntityPage.jsx`، `aomsEngine.js` | `verify-acceptance.mjs` (`FIELD-004`) — **PASS** |
| **FIELD-005** | تعديل التسمية لا يغير المفتاح ولا القيم | لم يكن مطبقًا | `saveCategoryField`، `trg_protect_category_fields_fn` | `verify-acceptance.mjs` (`FIELD-005`) — **PASS** |
| **FIELD-006** | منع تغيير النوع بعد وجود قيمة تاريخية | لم يكن هناك قيد في SQL أو الخدمة | `trg_protect_category_fields_fn`، `validateDynamicFieldDef` | `verify-acceptance.mjs` (`FIELD-006`) — **PASS** |
| **FIELD-007** | تعطيل حقل مستخدم يخفي الإدخال ويحفظ التاريخ ويمنع حذفه ماديًا | كان الحذف المادي ممكنًا | `trg_protect_category_fields_fn`، `physicalDelete` في `aomsEngine.js` | `verify-acceptance.mjs` (`FIELD-007`) — **PASS** |
| **FIELD-008** | الحقل الجديد يظهر تاريخيًا كفارغ (`null`) دون صفوف إلزامية | لم يكن معالجًا في التقارير | `buildAomsReport` (`aomsEngine.js`) | `verify-acceptance.mjs` (`FIELD-008`) — **PASS** |
| **FIELD-009** | الحقل الإلزامي الجديد لا يكسر عرض السجلات القديمة | لم يكن موثقًا بـ `required_since` | إضافة `required_since` وقراءة السجلات القديمة بأمان | `verify-acceptance.mjs` (`FIELD-009`) — **PASS** |
| **FIELD-010** | عند تعديل سجل قديم بعد تفعيل الإلزام يطلب القيمة | لم يكن مفروضًا عند التعديل | `validate_and_save_dynamic_values` في SQL و`_validateAndSaveDynamicValuesSync` في `aomsEngine.js` | `verify-acceptance.mjs` (`FIELD-010`) — **PASS** |
| **FIELD-011** | الحقول المخفية من التقارير (`show_in_reports=false`) لا تصدر | لم يكن هناك محرك تقارير للحقول الديناميكية | `buildAomsReport` (`aomsEngine.js`)، `aomsReportService.js` | `verify-acceptance.mjs` (`FIELD-011`) — **PASS** |
| **FIELD-012** | خيارات القائمة المنسدلة المستخدمة لا تُحذف ماديًا | لم يكن هناك Trigger يحمي الخيارات | `trg_protect_field_options_fn` في SQL و`physicalDelete` في `aomsEngine.js` | `verify-acceptance.mjs` (`FIELD-012`) — **PASS** |

## 3. الأصول والمعدات (`ASSET-001` إلى `ASSET-014`)

| المعرّف | المطلب / معيار القبول | الفجوة في الحزمة الانتقالية | الإصلاح المنفذ وملفات التنفيذ | الاختبار والنتيجة الفعلية |
| :--- | :--- | :--- | :--- | :--- |
| **ASSET-001** | إنشاء أصل يولد كودًا صحيحًا من 4 أرقام (`PREFIX-0001`) | كان يعمل في SQL فقط دون حفظ القيم الديناميكية | `create_asset` RPC، `aomsEngine.js` (`createAsset`) | `verify-acceptance.mjs` (`ASSET-001`) — **PASS** |
| **ASSET-002** | إنشاء أصلين متزامنين لا ينتج كودًا مكررًا | لم يكن مختبرًا تحت التزامن | قفل `FOR UPDATE` في SQL وقفل تسلسلي `_atomic` في `aomsEngine.js` | `verify-acceptance.mjs` (`ASSET-002`) — **PASS** |
| **ASSET-003** | الترتيب الافتراضي حسب الكود تصاعديًا | لم يكن مطبقًا في الواجهة | `EntityPage.jsx`، `aomsEngine.js` (`asset_code.localeCompare`) | `verify-acceptance.mjs` (`ASSET-003`) — **PASS** |
| **ASSET-004** | منع إنشاء أصل بتصنيف معطل | لم يكن مطبقًا في التعديل/النقل | `create_asset` و`update_asset` RPCs و`aomsEngine.js` | `verify-acceptance.mjs` (`ASSET-004`) — **PASS** |
| **ASSET-005** | تعيين أصل افتراضي يلغي السابق ذريًا | لم يسجل في التدقيق والخط الزمني | `set_default_asset` RPC، `setDefaultAsset` في `aomsEngine.js` | `verify-acceptance.mjs` (`ASSET-005`) — **PASS** |
| **ASSET-006** | منع أصل معطل من أن يكون افتراضيًا | قيد ناقص عند التحديث | قيد `check (status = 'active' or is_default = false)` و`update_asset` | `verify-acceptance.mjs` (`ASSET-006`) — **PASS** |
| **ASSET-007** | تعطيل الافتراضي ينقل الصفة تلقائيًا لأول أصل نشط حسب الكود | **كان مفقودًا تمامًا في SQL والكود** | منفذ في `update_asset` RPC وفي `aomsEngine.js` (`updateAsset`) | `verify-acceptance.mjs` (`ASSET-007`) — **PASS** |
| **ASSET-008** | عدم وجود بديل نشط يترك التصنيف بلا افتراضي | كان مفقودًا | منفذ في `update_asset` RPC و`aomsEngine.js` | `verify-acceptance.mjs` (`ASSET-008`) — **PASS** |
| **ASSET-009** | الأصل المعطل للقراءة والتقارير فقط | لم يكن هناك نموذج تعديل حالة الأصل | `EntityPage.jsx`، منع التشغيل والوقود والكلور للأصل المعطل | `verify-acceptance.mjs` (`ASSET-009`) — **PASS** |
| **ASSET-010** | إعادة التفعيل لا تجعله افتراضيًا تلقائيًا | لم يكن مفحوصًا | منفذ في `update_asset` RPC و`aomsEngine.js` | `verify-acceptance.mjs` (`ASSET-010`) — **PASS** |
| **ASSET-011** | منع الحذف النهائي للأصل | كان الحذف المباشر متاحًا للمدير | `trg_no_delete_assets` في SQL و`physicalDelete` في `aomsEngine.js` | `verify-acceptance.mjs` (`ASSET-011`) — **PASS** |
| **ASSET-012..014** | الوراثة والتجاوز وإلغاء التجاوز (بما فيه الصفر) | لم تكن هناك واجهة لتعيين وإلغاء التجاوز | `EntityPage.jsx`، `update_asset` RPC، `effectiveValue` (`models.js`) | `verify-acceptance.mjs` (`ASSET-012..014`) — **PASS** |

## 4. المشغلون (`OPERATOR-001` إلى `OPERATOR-005`)

| المعرّف | المطلب / معيار القبول | الفجوة في الحزمة الانتقالية | الإصلاح المنفذ وملفات التنفيذ | الاختبار والنتيجة الفعلية |
| :--- | :--- | :--- | :--- | :--- |
| **OPERATOR-001..005** | إنشاء المشغل، تعطيله يخفيه من الإدخال الجديد، بقاء اسمه تاريخيًا، إعادة تفعيله، ومنع حذفه ماديًا | لم تكن هناك واجهة إدارة مشغلين ولا فحص نشاط المشغل في `save_operation_log` | `EntityPage.jsx`، `save_operation_log` RPC، `trg_no_delete_operators`، `aomsEngine.js` | `verify-acceptance.mjs` (`OPERATOR-001..005`) — **PASS** |

## 5. سجلات التشغيل (`OPLOG-001` إلى `OPLOG-021`)

| المعرّف | المطلب / معيار القبول | الفجوة في الحزمة الانتقالية | الإصلاح المنفذ وملفات التنفيذ | الاختبار والنتيجة الفعلية |
| :--- | :--- | :--- | :--- | :--- |
| **OPLOG-001..010** | سجل واحد يوميًا، رفض المكرر والمستقبلي، اختيار التصنيف ثم الأصل والافتراضي، العداد الاختياري، القراءة السابقة، وتغيير العداد | كانت `EntityPage.jsx` تعرض جدولًا عامًا دون اختيار تصنيف/أصل ودون نموذج إدخال | `EntityPage.jsx` (قسم `operation_logs`)، `save_operation_log` RPC، `aomsEngine.js` | `verify-acceptance.mjs` (`OPLOG-001..010`) — **PASS** |
| **OPLOG-011..021** | تعديل وحذف آخر سجل فقط، منع تغيير الأصل، حفظ الحقول الديناميكية، حساب الوقود والكلور، وتحديث الأرصدة والتدقيق | **لم تكن `save_operation_log` تدعم التعديل ولا حفظ القيم الديناميكية** | استكمال `save_operation_log` لدعم التعديل وفحص `version` وحفظ `operation_log_values` والتحقق من الأرصدة | `verify-acceptance.mjs` (`OPLOG-011..021`) — **PASS** |

## 6. الوقود والكلور (`FUEL-001` إلى `FUEL-014` و`CHL-001` إلى `CHL-008`)

| المعرّف | المطلب / معيار القبول | الفجوة في الحزمة الانتقالية | الإصلاح المنفذ وملفات التنفيذ | الاختبار والنتيجة الفعلية |
| :--- | :--- | :--- | :--- | :--- |
| **FUEL-001..014** | إدارة أنواع الوقود، منع حذف المستخدم، التزويد والتسويات، تعديل/حذف آخر حركة فقط، حساب الرصيد لكل أصل ونوع وقود، ومنع الرصيد السالب | لم تكن هناك دوال لتعديل أو حذف آخر حركة وقود، وكان View الرصيد يطرح الاستهلاك من كل الأنواع | تحديث `asset_fuel_balances`، إضافة التعديل والحذف في `save_fuel_transaction` و`delete_fuel_transaction`، وواجهة `EntityPage.jsx` | `verify-acceptance.mjs` (`FUEL-001..014`) — **PASS** |
| **CHL-001..008** | حركات الاستلام والتسويات للأصول المؤهلة فقط، تعديل/حذف آخر حركة فقط، خصم استهلاك التشغيل، ومنع الرصيد السالب | لم تكن هناك دوال لتعديل أو حذف آخر حركة كلور ولا واجهة إدخال | تحديث `save_chlorine_transaction` و`delete_chlorine_transaction`، وواجهة الكلور في `EntityPage.jsx` | `verify-acceptance.mjs` (`CHL-001..008`) — **PASS** |

## 7. البحث، التقارير، الخط الزمني، التدقيق، المصادقة، المزامنة، والنسخ الاحتياطي

| المجموعة | المعرّفات | الفجوة في الحزمة الانتقالية | الإصلاح المنفذ وملفات التنفيذ | الاختبار والنتيجة الفعلية |
| :--- | :--- | :--- | :--- | :--- |
| **البحث العالمي** | `SEARCH-001..005` | كان `global_search` يبحث في `assets` و`operators` فقط ويغفل 4 كيانات والقيم الديناميكية | توسيع `global_search` في SQL و`globalSearchState` في `aomsEngine.js` ليشمل الكيانات الستة والقيم الديناميكية والانتقال للسجل | `verify-acceptance.mjs` (`SEARCH-001..005`) — **PASS** |
| **التقارير المتعددة** | `REPORT-001..011` | لم تكن هناك صفحة تقارير متعددة النطاقات ولا فصل للوحدات المختلفة | إنشاء `buildAomsReport` و`aomsReportService.js` وواجهة التقارير الشاملة (Excel/CSV/PDF) | `verify-acceptance.mjs` (`REPORT-001..011`) — **PASS** |
| **الخط الزمني والتدقيق** | `TIME-001..003`, `AUDIT-001..004` | كان `audit_logs` مكشوفًا للقراءة لجميع المستخدمين في RLS بدل المدير فقط | قصر سياسة قراءة `audit_logs` على `is_admin()` في SQL و`aomsEngine.js` وإضافة تبويب التدقيق للمدير | `verify-acceptance.mjs` (`TIME` & `AUDIT`) — **PASS** |
| **المصادقة والصلاحيات** | `AUTH-001..010` | غياب استعادة كلمة المرور وإدارة المستخدمين والأدوار في الواجهة | إضافة استعادة كلمة المرور في `Login.jsx` وصفحة إدارة المستخدمين `/users` للمدير | `verify-acceptance.mjs` (`AUTH-001..010`) — **PASS** |
| **المزامنة وOffline** | `SYNC-001..009` | لم يكن تعارض الإصدار يعرض النسخة الحالية للمستخدم | إضافة شريط تعارض الإصدارات في `EntityPage.jsx` مع زر إعادة تحميل النسخة الحالية وتعطيل الكتابة Offline | `verify-acceptance.mjs` (`SYNC-001..009`) — **PASS** |
| **النسخ الاحتياطي والاستعادة** | `BACKUP-001..008` | **كانت `restore_aoms_backup` ترفض الاستعادة دائمًا باعتبارها غير منفذة** | تنفيذ الاستعادة الذرية الكاملة في `restore_aoms_backup` (SQL) و`aomsEngine.js` مع معاينة ما قبل الاستعادة ونسخة الأمان والتراجع الكامل (`Rollback`) عند أي خطأ | `verify-acceptance.mjs` (`BACKUP-001..008`) — **PASS** |
| **الانحدار والجودة** | `REG-001..008` | كان `scripts/static-check.mjs` يحتوي على `SyntaxError` يكسر `npm run lint` | إصلاح `scripts/static-check.mjs` وتشغيل فحص الأسرار واختبارات القبول بنجاح 100% | `npm run lint` — **PASS** |
