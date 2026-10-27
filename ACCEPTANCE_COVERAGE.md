# مصفوفة تغطية معايير القبول (القسم 22) — 144 معيارًا

أُنشئت في تدقيق 2026-10-27. الرموز: **L** = اختبار قاعدة بيانات حقيقي على PostgreSQL 17 (`npm run test:db`)، **E** = Playwright على التطبيق المبني (المصادقة محاكاة؛ Realtime محاكى إلا في خطوة realtimeReal التي تستخدم خادم supabase/realtime حقيقيًا محليًا)، **U** = اختبار Vitest على كود الخدمة الحقيقي (`src/services/reportAcceptance.test.js`)، **acc/** = `supabase/tests/run-db-acceptance.mjs`، **M** = النموذج المرجعي في الذاكرة (`verify-acceptance.mjs`)، **S** = فحص ثابت، **N** = غير متحقق.

| الحالة | العدد |
|---|---|
| متحقق حيًا | 141 |
| جزئي | 1 |
| نموذج/ثابت فقط | 1 |
| غير متحقق | 1 |

> "متحقق حيًا" تعني وجود فحص L أو E أو U واحد (منفَّذ فعلًا) على الأقل يغطي المعيار؛ لا تعني تغطية كل حالاته الحدية.

| المعرف | المعيار | الدليل | الحالة |
|---|---|---|---|
| CAT-001 | إنشاء تصنيف نشط باسم واختصار فريد ينجح. | L:seed(admin creates categories) M:A1,A2 | متحقق حيًا |
| CAT-002 | رفض الاسم الفارغ. | L:acc/CAT-002 | متحقق حيًا |
| CAT-003 | رفض اختصار مكرر ولو اختلفت حالة الأحرف أو المسافات. | L:acc/CAT-003 | متحقق حيًا |
| CAT-004 | رفض وحدة عداد عند `uses_meter=false` أو تنظيفها آمنًا. | L:acc/CAT-004 | متحقق حيًا |
| CAT-005 | إلزام وحدة العداد عند `uses_meter=true`. | L:acc/CAT-005 | متحقق حيًا |
| CAT-006 | تعطيل التصنيف يمنع إنشاء أصل تحته. | L:acc/CAT-006 | متحقق حيًا |
| CAT-007 | إعادة التفعيل تعيد إمكانية الإنشاء. | L:acc/CAT-007 | متحقق حيًا |
| CAT-008 | منع حذف التصنيف ماديًا. | L:SEC-AUTH-02 | متحقق حيًا |
| CAT-009 | منع تغيير الاختصار بعد وجود أصول. | L:CAT-PREFIX-LOCK M:B4 | متحقق حيًا |
| CAT-010 | استمرار تسلسل الكود بعد إعادة التفعيل. | L:acc/CAT-010 | متحقق حيًا |
| CAT-011 | تصنيف يستخدم عدادًا دون وقود يعمل طبيعيًا. | L:acc/CAT-011 | متحقق حيًا |
| CAT-012 | تصنيف لا يستخدم عدادًا يعرض سجلًا بلا قراءات. | L:acc/CAT-012 | متحقق حيًا |
| FIELD-001 | إنشاء كل نوع من الأنواع الخمسة. | L:FIELD-TYPES-OK M:A11,A12,A14 | متحقق حيًا |
| FIELD-002 | تنفيذ التحقق الصحيح لكل نوع. | L:FIELD-TYPES-OK | متحقق حيًا |
| FIELD-003 | رفض قائمة منسدلة بلا خيارات نشطة. | L:test:db FIELD-003 + acc/FIELD-003 (DB deferred triggers, migration 202610270004; negative control evidence/50) U:fieldValidation | متحقق حيًا |
| FIELD-004 | ترتيب الحقول ينعكس في نماذج الأصل والتشغيل. | E:formsUi/FIELD-004 (asset dialog + operation form order) | متحقق حيًا |
| FIELD-005 | تعديل التسمية لا يغير المفتاح ولا القيم. | L:acc/FIELD-005 | متحقق حيًا |
| FIELD-006 | منع تغيير النوع بعد وجود قيمة تاريخية. | L:FIELD-TYPE-LOCK | متحقق حيًا |
| FIELD-007 | تعطيل حقل مستخدم يخفي الإدخال ويحفظ التاريخ. | L:acc/FIELD-007 | متحقق حيًا |
| FIELD-008 | الحقل الجديد يظهر تاريخيًا كفارغ. | L:acc/FIELD-008 | متحقق حيًا |
| FIELD-009 | الحقل الإلزامي الجديد لا يكسر عرض السجلات القديمة. | L:acc/FIELD-009 | متحقق حيًا |
| FIELD-010 | عند تعديل سجل قديم بعد تفعيل الإلزام يطلب القيمة. | L:acc/FIELD-010 | متحقق حيًا |
| FIELD-011 | الحقول المخفية من التقارير لا تصدر. | U:reportAcceptance E:reports/FIELD-011 (screen + CSV) | متحقق حيًا |
| FIELD-012 | خيارات مستخدمة لا تُحذف ماديًا. | L:acc/FIELD-012 | متحقق حيًا |
| ASSET-001 | إنشاء أصل يولد كودًا صحيحًا من 4 أرقام. | L:ASSET-CODE-RACE M:B2 | متحقق حيًا |
| ASSET-002 | إنشاء أصلين متزامنين لا ينتج كودًا مكررًا. | L:ASSET-CODE-RACE | متحقق حيًا |
| ASSET-003 | الترتيب الافتراضي حسب الكود. | E:formsUi/ASSET-003 | متحقق حيًا |
| ASSET-004 | منع إنشاء أصل بتصنيف معطل. | L:acc/ASSET-004 | متحقق حيًا |
| ASSET-005 | تعيين أصل افتراضي يلغي السابق. | L:DEFAULT-RACE,DEFAULT-CREATE-TIMELINE M:B5 | متحقق حيًا |
| ASSET-006 | منع أصل معطل من أن يكون افتراضيًا. | L:acc/ASSET-006 M:B8 | متحقق حيًا |
| ASSET-007 | تعطيل الافتراضي ينقل الصفة لأول نشط حسب الكود. | L:DEFAULT-TRANSFER M:B9 | متحقق حيًا |
| ASSET-008 | عدم وجود بديل يترك التصنيف بلا افتراضي. | L:acc/ASSET-008 | متحقق حيًا |
| ASSET-009 | الأصل المعطل للقراءة والتقارير فقط. | L:acc/ASSET-009 | متحقق حيًا |
| ASSET-010 | إعادة التفعيل لا تجعله افتراضيًا تلقائيًا. | L:acc/ASSET-010 | متحقق حيًا |
| ASSET-011 | منع الحذف النهائي. | L:acc/ASSET-011 | متحقق حيًا |
| ASSET-012 | الوراثة تستخدم قيمة التصنيف الحالية. | L:acc/ASSET-012 | متحقق حيًا |
| ASSET-013 | التجاوز يبقى ثابتًا بعد تعديل التصنيف. | L:acc/ASSET-013 | متحقق حيًا |
| ASSET-014 | إلغاء التجاوز يعيد الوراثة. | L:acc/ASSET-014 | متحقق حيًا |
| OPERATOR-001 | إنشاء مشغل نشط. | L:seed M:C1 | متحقق حيًا |
| OPERATOR-002 | تعطيله يخفيه من الإدخال الجديد. | L:acc/OPERATOR-002 | متحقق حيًا |
| OPERATOR-003 | يبقى اسمه في التاريخ. | L:acc/OPERATOR-003 | متحقق حيًا |
| OPERATOR-004 | إعادة التفعيل تعيده للقوائم. | L:acc/OPERATOR-004 E:formsUi/OPERATOR-004 | متحقق حيًا |
| OPERATOR-005 | منع حذفه ماديًا. | L:acc/OPERATOR-005 | متحقق حيًا |
| OPLOG-001 | إنشاء سجل واحد للأصل في اليوم. | L:OPLOG-SAME-DAY-RACE E:writeFlow | متحقق حيًا |
| OPLOG-002 | رفض السجل الثاني لليوم نفسه حتى بطلب API مباشر. | L:OPLOG-SAME-DAY-RACE M:C4 | متحقق حيًا |
| OPLOG-003 | رفض تاريخ مستقبلي. | L:OPLOG-FUTURE | متحقق حيًا |
| OPLOG-004 | التصنيف بلا عداد لا يعرض القراءات. | E:formsUi/OPLOG-004 M:C9 | متحقق حيًا |
| OPLOG-005 | التصنيف بعداد يجلب القراءة السابقة الصحيحة. | M:C6 E:writeFlow | متحقق حيًا |
| OPLOG-006 | حساب فرق القراءة بدقة. | L:OPLOG-CALC E:writeFlow | متحقق حيًا |
| OPLOG-007 | رفض قراءة حالية غير صالحة وفق قواعد العداد. | L:acc/OPLOG-007 | متحقق حيًا |
| OPLOG-008 | التاريخ الافتراضي = آخر تاريخ + يوم. | E:formsUi/OPLOG-008 M:C5 (defect fixed: form defaulted to today) | متحقق حيًا |
| OPLOG-009 | منع سجل جديد إذا كان آخر سجل اليوم. | M:C10 E:writeFlow(same-day rule) | متحقق حيًا |
| OPLOG-010 | منع سجل لأصل معطل. | L:acc/OPLOG-010 | متحقق حيًا |
| OPLOG-011 | آخر سجل فقط قابل للتعديل. | L:OPLOG-NOT-LATEST-EDIT,OPLOG-NOT-LATEST-SQL M:C7 | متحقق حيًا |
| OPLOG-012 | آخر سجل فقط قابل للحذف. | L:OPLOG-NOT-LATEST-DELETE M:C7 | متحقق حيًا |
| OPLOG-013 | منع تغيير الأصل أثناء التعديل. | L:acc/OPLOG-013 | متحقق حيًا |
| OPLOG-014 | الحقول الديناميكية تحفظ وتقرأ بأنواعها. | L:FIELD-TYPES-OK E:writeFlow(oil_temp) | متحقق حيًا |
| OPLOG-015 | المشغل غير النشط يبقى ظاهرًا في القديم. | L:acc/OPLOG-015 E:formsUi/OPLOG-015 | متحقق حيًا |
| OPLOG-016 | استهلاك الوقود = فرق العداد × المعدل الفعلي. | L:OPLOG-CALC E:writeFlow(36 L) | متحقق حيًا |
| OPLOG-017 | تجاوز الأصل يغلب افتراضي التصنيف. | L:acc/OPLOG-017 | متحقق حيًا |
| OPLOG-018 | تصنيف بعداد دون وقود لا يحسب وقودًا. | L:acc/OPLOG-018 | متحقق حيًا |
| OPLOG-019 | الكلور يظهر فقط للتصنيف المؤهل. | L:acc/OPLOG-019 E:formsUi/OPLOG-019 | متحقق حيًا |
| OPLOG-020 | تعديل آخر سجل يعيد كل المؤشرات والأرصدة. | L:acc/OPLOG-020 | متحقق حيًا |
| OPLOG-021 | أحداث الإنشاء والتعديل والحذف تظهر في الخط الزمني والتدقيق. | L:acc/OPLOG-021 | متحقق حيًا |
| FUEL-001 | إنشاء نوع وقود وإظهاره. | L:seed M:B1 | متحقق حيًا |
| FUEL-002 | تعطيل النوع يخفيه من الجديد ويحفظ القديم. | L:acc/FUEL-002 | متحقق حيًا |
| FUEL-003 | منع حذف نوع مستخدم. | L:acc/FUEL-003 | متحقق حيًا |
| FUEL-004 | إضافة تزويد لأصل مؤهل نشط. | L:seed M:D1 | متحقق حيًا |
| FUEL-005 | منع التزويد لأصل غير مؤهل أو معطل. | L:acc/FUEL-005 | متحقق حيًا |
| FUEL-006 | رفض كمية صفرية أو سالبة. | L:acc/FUEL-006 | متحقق حيًا |
| FUEL-007 | التسوية تتطلب سببًا. | L:acc/FUEL-007 | متحقق حيًا |
| FUEL-008 | الرصيد يحسب التزويد والتسويات والاستهلاك. | L:FUEL-PARALLEL-WITHDRAW M:D1 | متحقق حيًا |
| FUEL-009 | الرصيد منفصل لكل أصل ونوع وقود. | L:acc/FUEL-009 | متحقق حيًا |
| FUEL-010 | آخر حركة فقط قابلة للتعديل والحذف. | L:acc/FUEL-010 | متحقق حيًا |
| FUEL-011 | التعديل والحذف يعيدان الرصيد فورًا. | L:acc/FUEL-011 | متحقق حيًا |
| FUEL-012 | المورد نص حر ورقم الفاتورة اختياري. | L:acc/FUEL-012 | متحقق حيًا |
| FUEL-013 | لا تظهر حقول سعر أو تكلفة. | L:acc/FUEL-013 | متحقق حيًا |
| FUEL-014 | منع الرصيد السالب وفق القاعدة المعتمدة. | L:FUEL-OVERDRAW,FUEL-PARALLEL-WITHDRAW,FUEL-DELETE-VS-CONSUME-RACE,BAL-INVARIANT-GLOBAL M:D2 | متحقق حيًا |
| CHL-001 | حركة استلام لأصل مؤهل نشط. | L:CHL-FLOW M:D4 | متحقق حيًا |
| CHL-002 | منع الحركة لأصل تصنيفه لا يدعم الكلور. | L:acc/CHL-002 | متحقق حيًا |
| CHL-003 | التسويات تتطلب سببًا. | L:acc/CHL-003 | متحقق حيًا |
| CHL-004 | الرصيد يخصم استهلاك التشغيل. | L:CHL-FLOW | متحقق حيًا |
| CHL-005 | آخر حركة فقط قابلة للتعديل والحذف. | L:acc/CHL-005 | متحقق حيًا |
| CHL-006 | الوحدة ثابتة ومتسقة في الإدخال والتقرير. | L:acc/CHL-006 U:reportAcceptance E:reports/CHL-006 | متحقق حيًا |
| CHL-007 | تعديل استهلاك التشغيل يعيد رصيد الكلور. | L:acc/CHL-007 | متحقق حيًا |
| CHL-008 | لا سعر أو تكلفة. | L:acc/CHL-008 | متحقق حيًا |
| SEARCH-001 | البحث بالكود والاسم والموقع والملاحظات. | L:SEARCH-CODE,SEARCH-OPTION-LABEL M:F1 | متحقق حيًا |
| SEARCH-002 | البحث في الكيانات الستة المعتمدة. | L:acc/SEARCH-002 | متحقق حيًا |
| SEARCH-003 | تجميع النتائج حسب النوع. | E:searchTimeline/SEARCH-003 | متحقق حيًا |
| SEARCH-004 | فتح النتيجة ينقل للأصل والتبويب والسجل. | E:searchTimeline/SEARCH-004 (defect fixed: highlight only on op logs) | متحقق حيًا |
| SEARCH-005 | لا تظهر نتائج غير مصرح بها. | L:SEARCH-RLS | متحقق حيًا |
| REPORT-001 | تقرير أصل واحد. | U:reportAcceptance E:reports/REPORT-001 | متحقق حيًا |
| REPORT-002 | تقرير تصنيف كامل. | U:reportAcceptance E:reports/REPORT-002 | متحقق حيًا |
| REPORT-003 | تقرير أصول متعددة من تصنيفات مختلفة. | U:reportAcceptance E:reports/REPORT-003 (defect fixed: fuel/chlorine ignored multi_assets) | متحقق حيًا |
| REPORT-004 | تقرير جميع الأصول. | U:reportAcceptance E:reports/REPORT-004 | متحقق حيًا |
| REPORT-005 | فلتر من/إلى شامل وصحيح. | U:reportAcceptance E:reports/REPORT-005 | متحقق حيًا |
| REPORT-006 | الحقول الديناميكية غير المنطبقة فارغة. | U:reportAcceptance E:reports/REPORT-006 (defect fixed: dynamic fields dropped) | متحقق حيًا |
| REPORT-007 | عدم جمع الوحدات المختلفة. | U:reportAcceptance E:reports/REPORT-007 (defect fixed: chlorine summed across units, screen count 0) | متحقق حيًا |
| REPORT-008 | تطابق الشاشة وExcel وCSV والطباعة. | U:reportAcceptance E:reports/REPORT-008 (csv/xlsx/pdf parsed == screen) | متحقق حيًا |
| REPORT-009 | Excel RTL ومنسق ومحمي من القيم غير الصحيحة. | U:reportAcceptance E:reports/REPORT-009 (xlsx parsed: RTL view, header, rows) | متحقق حيًا |
| REPORT-010 | CSV محمي من Formula Injection. | U:reportAcceptance E:reports/REPORT-010 (BOM; defect fixed: CSV formula injection) | متحقق حيًا |
| REPORT-011 | PDF/الطباعة RTL ومتجاوب. | E:reports/REPORT-011 (pdftotext: every Arabic header/row word logical+unbroken, scope label, Amiri embedded, A4 landscape) U:auditFixes REPORT-011 (glyph run vs. reversed; negative control evidence/57) + rendered PNGs inspected (evidence/report011) — defects fixed: reversed Arabic in cells, mirrored brackets, raw scope key, mid-word wrapping | متحقق حيًا |
| TIME-001 | جميع أحداث الأصل المهمة تظهر. | L:acc/TIME-001 | متحقق حيًا |
| TIME-002 | الترتيب من الأحدث للأقدم. | E:searchTimeline/TIME-002 (defect fixed: unsorted) | متحقق حيًا |
| TIME-003 | الحدث يفتح الكيان المرتبط. | E:searchTimeline/TIME-003 (defect fixed: wrong target page) | متحقق حيًا |
| AUDIT-001 | قبل/بعد محفوظان للتعديلات. | L:AUDIT-001 | متحقق حيًا |
| AUDIT-002 | المستخدم والوقت صحيحان. | L:acc/AUDIT-002 | متحقق حيًا |
| AUDIT-003 | لا يمكن للمستخدم تعديل Audit. | L:AUDIT-IMMUTABLE-ADMIN,AUDIT-IMMUTABLE-SU,AUDIT-ADMIN-ONLY | متحقق حيًا |
| AUDIT-004 | حذف السجل الوظيفي لا يحذف تدقيقه. | L:acc/AUDIT-004 | متحقق حيًا |
| AUTH-001 | منع الوصول دون تسجيل. | L:SEC-ANON-01,SEC-ANON-02 E:badLogin | متحقق حيًا |
| AUTH-002 | منع المستخدم غير النشط. | L:AUTH-INACTIVE M:E4 | متحقق حيًا |
| AUTH-003 | Administrator ينفذ كل العمليات المسموحة. | L:seed + admin RPCs | متحقق حيًا |
| AUTH-004 | Operator لا يدير التصنيفات أو المستخدمين. | L:SEC-AUTH-01 M:E2 E:permissions | متحقق حيًا |
| AUTH-005 | Viewer قراءة فقط. | L:OPLOG-VIEWER M:E3 E:permissions | متحقق حيًا |
| AUTH-006 | إخفاء الأزرار وفق الدور. | E:permissions (add-operator button only) | متحقق حيًا |
| AUTH-007 | رفض الطلب المباشر المخالف حتى لو عُدل العميل. | L:SEC-AUTH-01..04,BACKUP-OPERATOR,SETTINGS-UPSERT-OPERATOR | متحقق حيًا |
| AUTH-008 | `created_by/updated_by` صحيحان. | L:AUTH-008 E:writeFlow(created_by) | متحقق حيًا |
| AUTH-009 | عدم وجود service key في bundle أو المستودع. | E:keysRuntime/AUTH-009 (bundle + request headers) S:static-check + gitleaks history/tree/zip (evidence/41-42, negative control 54) | متحقق حيًا |
| AUTH-010 | RLS مفعلة على كل الجداول. | L:DB-STRUCT-01 | متحقق حيًا |
| SYNC-001 | بعد تحميل سابق، العرض يعمل دون اتصال. | E:offline (reload shell + cached data) | متحقق حيًا |
| SYNC-002 | البحث في Cache يعمل دون اتصال. | E:offlineSync/SYNC-002 | متحقق حيًا |
| SYNC-003 | التقارير المحلية تعمل وفق البيانات المتاحة. | E:offlineSync/SYNC-003 | متحقق حيًا |
| SYNC-004 | جميع عمليات الكتابة معطلة دون اتصال. | E:offline (save disabled) M:E5 | متحقق حيًا |
| SYNC-005 | يظهر مؤشر قراءة فقط. | E:offline (banner/chip) | متحقق حيًا |
| SYNC-006 | عودة الاتصال تحدث البيانات. | E:offlineSync/SYNC-006 | متحقق حيًا |
| SYNC-007 | تغيير جهاز أول يظهر على الثاني. | E:realtimeReal/SYNC-007,SYNC-007-RLS (real supabase/realtime v2.148.1 server on local PG logical replication; 2 browser contexts) + offlineSync/SYNC-007-MOCK; negative control evidence/51 | متحقق حيًا |
| SYNC-008 | تعارض version يرفض الحفظ الصامت. | L:SYNC-008,OPLOG-VERSION E:conflict M:E1 | متحقق حيًا |
| SYNC-009 | لا Queue لكتابات Offline. | E:offlineSync/SYNC-009 (offline: every write button disabled, no queue keys in localStorage/IndexedDB) M:E5 | متحقق حيًا |
| BACKUP-001 | ملف واحد يشمل كل الكيانات المعتمدة. | L:RESTORE-ROUNDTRIP M:G1 | متحقق حيًا |
| BACKUP-002 | لا يحتوي كلمات مرور أو أسرارًا. | L:acc/BACKUP-002 | متحقق حيًا |
| BACKUP-003 | التحقق يرفض بنية تالفة أو مراجع يتيمة. | L:RESTORE-MISSING-TABLE,RESTORE-ATOMIC-BADROW M:G2 | متحقق حيًا |
| BACKUP-004 | معاينة قبل الاستعادة. | E:backupUi/BACKUP-004 M:P2 | متحقق حيًا |
| BACKUP-005 | نسخة أمان قبل الاستعادة. | E:backupUi/BACKUP-005 (safety file downloaded before restore) | متحقق حيًا |
| BACKUP-006 | الاستعادة الكاملة تعيد الأعداد والقيم والعلاقات. | L:RESTORE-ROUNDTRIP,RESTORE-FOREIGN-PROFILES | متحقق حيًا |
| BACKUP-007 | الفشل لا يترك حالة جزئية. | L:RESTORE-ATOMIC-ROLLBACK,RESTORE-ATOMIC-BADROW M:G3 | متحقق حيًا |
| BACKUP-008 | الصلاحية للمدير فقط. | L:BACKUP-OPERATOR | متحقق حيًا |
| REG-001 | RTL والوضعان محفوظان. | E:matrix (dir=rtl, light/dark, theme persisted) | متحقق حيًا |
| REG-002 | PWA وService Worker يعملان. | E:pwa | متحقق حيًا |
| REG-003 | GitHub Actions يبني ويختبر وينشر. | S:actionlint 0 errors + local Node 22 replay of build job (install/lint/test/build) — real GitHub Actions run & Pages deploy NOT run (needs push) (partial) | جزئي |
| REG-004 | لا أخطاء Console حرجة. | E:matrix,conflict (0 console errors) | متحقق حيًا |
| REG-005 | لا أسرار أو بيانات حساسة في المستودع. | S:gitleaks history+tree+zip 0 leaks (negative control finds planted JWT+PAT) + static-check — gitleaks misses AWS-style key in control, so not exhaustive (static only) | نموذج/ثابت فقط |
| REG-006 | الفلاتر والترقيم والاستجابة تعمل. | L:REG-006-DB E:largeData/REG-006,REG-006-HIGHLIGHT,REG-006-FILTER (3000 logs, paged fetch past db-max-rows=1000) U:supabaseRepository,Paged | متحقق حيًا |
| REG-007 | تقارير النسخة الجديدة لا تقل جودة عن الحالية. | N (subjective quality comparison with current reports — self-assessment only, see report) | غير متحقق |
| REG-008 | جميع الاختبارات القديمة الصالحة إما ناجحة أو استبدلت باختبارات مكافئة موثقة. | U: vitest 122/122 + L: test:db + E: e2e (see evidence 32/36/38/38c) | متحقق حيًا |

## أدلة الجولة الثانية

- قاعدة البيانات: `supabase/tests/run-db-acceptance.mjs` (58 فحصًا، معرّفاتها = معرّفات §22) ضمن `npm run test:db` → evidence/36-test-db.log.
- E2E: `e2e/acceptance-steps.mjs` (accSetup, searchTimeline, reports, formsUi, offlineSync, backupUi) → evidence/38-e2e.log و deliverables/e2e-results.json.
- الوحدات: `src/services/reportAcceptance.test.js`، `src/services/fieldValidation.test.js`.
- إثبات العيوب: نفس الاختبارات على كود الجولة الأولى (906f978 + الرقعة السابقة) تفشل: evidence/40-report-unit-on-round1-code.txt (4 فشل) و evidence/43-e2e-acceptance-on-round1-code.txt (8 فشل: إشعاران عند التعارض، تمييز البحث، ترتيب/وجهة الخط الزمني، أعمدة التقرير الديناميكية، ملخص التقرير، تاريخ OPLOG-008، تسميات الجوال).
- حدود الجولة الثانية (بعضها أُغلق في الثالثة): المصادقة (GoTrue) محاكاة؛ لم يُشغَّل GitHub Actions.

## أدلة الجولة الثالثة

- FIELD-003: قيود DB مؤجلة (migration 202610270004) + RPC save_category_field؛ بدونها يفشل الاختبار (evidence/50).
- SYNC-007: خادم supabase/realtime v2.148.1 حقيقي على PostgreSQL المحلي (wal_level=logical)، جهازان (admin/viewer) → evidence/38c-e2e-realtime-real.log؛ بدون الخادم يفشل (evidence/51).
- REPORT-011: إصلاح عكس الحروف العربية في خلايا الجدول والأقواس واسم النطاق وكسر الكلمات؛ فحص آلي بـ pdftotext + اختبار وحدة + صور PNG (evidence/40-pdf-report011.log, 57, 58, report011/).
- AUTH-009/REG-005: gitleaks على التاريخ والشجرة والحزمة (evidence/41, 42, 46) + ضابط سلبي (54).
- REG-003: actionlint + إعادة تشغيل محلية لخطوات build على Node 22 (evidence/43, 44)؛ تشغيل GitHub Actions الفعلي والنشر لم يُنفّذا (يتطلبان push).
- REG-007: تقييم ذاتي فقط.
